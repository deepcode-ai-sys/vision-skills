/**
 * Image loading and preprocessing utilities.
 *
 * Handles loading from path / URL / base64 / bytes, SSRF protection for URLs,
 * resizing + JPEG re-encode via sharp, and SHA256 hashing for cache keys.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import sharp from 'sharp';

import { ValidationError } from '../core/errors.js';
import type { ImageInput } from '../core/types.js';

// Magic byte signatures for supported formats
const MAGIC: Array<{ bytes: number[]; format: string }> = [
  { bytes: [0xff, 0xd8, 0xff], format: 'jpeg' },
  { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], format: 'png' },
  { bytes: [0x47, 0x49, 0x46, 0x38], format: 'gif' },
  { bytes: [0x52, 0x49, 0x46, 0x46], format: 'webp' }, // RIFF (needs WEBP check)
];

export interface PreprocessResult {
  buffer: Buffer;
  width: number;
  height: number;
}

export class ImageProcessor {
  constructor(
    private maxSizeMb = 10,
    private maxDimension = 2048,
    private jpegQuality = 85,
  ) {}

  private get maxSizeBytes(): number {
    return this.maxSizeMb * 1024 * 1024;
  }

  /** Load raw image bytes from any supported source. */
  async load(source: ImageInput): Promise<Buffer> {
    let data: Buffer;

    if (Buffer.isBuffer(source)) {
      data = source;
    } else if (source instanceof Uint8Array) {
      data = Buffer.from(source);
    } else if (typeof source === 'string') {
      if (source.startsWith('data:image/')) {
        data = this.fromBase64(source);
      } else if (source.startsWith('http://') || source.startsWith('https://')) {
        data = await this.fromUrl(source);
      } else {
        data = await this.fromPath(source);
      }
    } else {
      throw new ValidationError('Unsupported image input type');
    }

    this.validateSize(data);
    this.validateMagicBytes(data);
    return data;
  }

  /** Resize (if needed) and re-encode. Preserves PNG if image has alpha channel. */
  async preprocess(data: Buffer): Promise<PreprocessResult> {
    let image = sharp(data, { failOn: 'none' });
    const meta = await image.metadata();

    if (!meta.width || !meta.height) {
      throw new ValidationError('Unable to read image dimensions');
    }

    if (meta.width > this.maxDimension || meta.height > this.maxDimension) {
      image = image.resize(this.maxDimension, this.maxDimension, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    // Preserve PNG for images with alpha channel; otherwise use JPEG for smaller size
    const hasAlpha = meta.channels === 4;
    let buffer: Buffer;
    if (hasAlpha) {
      buffer = await image.png().toBuffer();
    } else {
      buffer = await image.jpeg({ quality: this.jpegQuality }).toBuffer();
    }

    const out = await sharp(buffer).metadata();
    return { buffer, width: out.width ?? meta.width, height: out.height ?? meta.height };
  }

  computeHash(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  // ---------------------------------------------------------------- loaders

  private async fromPath(path: string): Promise<Buffer> {
    // Path traversal protection: reject paths with .. or absolute paths outside expected dirs
    if (path.includes('..')) {
      throw new ValidationError('Path traversal detected: ".." not allowed in file paths');
    }
    
    try {
      return await readFile(path);
    } catch (err) {
      throw new ValidationError(`Failed to read image file: ${(err as Error).message}`);
    }
  }

  private fromBase64(dataUri: string): Buffer {
    const match = dataUri.match(/^data:image\/[a-zA-Z]+;base64,(.+)$/);
    if (!match || !match[1]) {
      throw new ValidationError('Invalid base64 image data URI');
    }
    return Buffer.from(match[1], 'base64');
  }

  private async fromUrl(url: string): Promise<Buffer> {
    await this.assertUrlSafe(url);

    const response = await fetch(url, { redirect: 'error' });
    if (!response.ok) {
      throw new ValidationError(`Failed to fetch image from URL: HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);
    if (data.length > this.maxSizeBytes) {
      throw new ValidationError('Image from URL exceeds size limit');
    }
    return data;
  }

  // ------------------------------------------------------------- validation

  private validateSize(data: Buffer): void {
    if (data.length > this.maxSizeBytes) {
      const mb = (data.length / (1024 * 1024)).toFixed(2);
      throw new ValidationError(`Image size ${mb}MB exceeds maximum ${this.maxSizeMb}MB`);
    }
  }

  private validateMagicBytes(data: Buffer): void {
    for (const { bytes, format } of MAGIC) {
      if (data.length < bytes.length) continue;
      const matches = bytes.every((b, i) => data[i] === b);
      if (matches) {
        if (format === 'webp' && data.subarray(8, 12).toString('ascii') !== 'WEBP') {
          continue;
        }
        return;
      }
    }
    throw new ValidationError('File does not appear to be a valid image (magic bytes check failed)');
  }

  /** Block SSRF: reject URLs that resolve to internal/private/loopback IPs. */
  async assertUrlSafe(url: string): Promise<void> {
    let hostname: string;
    let protocol: string;
    try {
      const parsed = new URL(url);
      hostname = parsed.hostname;
      protocol = parsed.protocol;
    } catch {
      throw new ValidationError('Invalid URL');
    }
    
    // Only allow http/https
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new ValidationError(`Unsupported URL protocol: ${protocol}. Only http and https are allowed.`);
    }
    
    if (!hostname) throw new ValidationError('Invalid URL: no hostname');

    // If hostname is already an IP, check it directly
    const direct = isIP(hostname);
    const addresses: string[] = [];
    if (direct) {
      addresses.push(hostname);
    } else {
      try {
        const resolved = await lookup(hostname, { all: true });
        addresses.push(...resolved.map((r) => r.address));
      } catch (err) {
        throw new ValidationError(`Failed to resolve URL hostname: ${(err as Error).message}`);
      }
    }

    for (const addr of addresses) {
      if (this.isBlockedIp(addr)) {
        throw new ValidationError(`URL resolves to a blocked IP range: ${addr} (SSRF protection)`);
      }
    }
  }

  private isBlockedIp(ip: string): boolean {
    // IPv6 loopback / link-local / unique-local
    if (ip.includes(':')) {
      const low = ip.toLowerCase();
      return (
        low === '::1' ||
        low.startsWith('fe80') ||
        low.startsWith('fc') ||
        low.startsWith('fd')
      );
    }
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
    const [a, b] = parts as [number, number, number, number];
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
}
