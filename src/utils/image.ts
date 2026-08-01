/**
 * Image loading and preprocessing utilities.
 *
 * Handles loading from path / URL / base64 / bytes, SSRF protection for URLs,
 * resizing + JPEG re-encode via sharp, and SHA256 hashing for cache keys.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
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
    private maxPixels = 40_000_000,
    private fetchTimeoutMs = 15_000,
  ) {}

  private get maxSizeBytes(): number {
    return this.maxSizeMb * 1024 * 1024;
  }

  /** Load raw image bytes from any supported source. */
  async load(source: ImageInput, signal?: AbortSignal): Promise<Buffer> {
    signal?.throwIfAborted();
    let data: Buffer;

    if (Buffer.isBuffer(source)) {
      data = source;
    } else if (source instanceof Uint8Array) {
      data = Buffer.from(source);
    } else if (typeof source === 'string') {
      if (source.startsWith('data:image/')) {
        data = this.fromBase64(source);
      } else if (source.startsWith('http://') || source.startsWith('https://')) {
        data = await this.fromUrl(source, signal);
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
  async preprocess(data: Buffer, signal?: AbortSignal): Promise<PreprocessResult> {
    signal?.throwIfAborted();
    let image = sharp(data, { failOn: 'none', limitInputPixels: this.maxPixels });
    const meta = await image.metadata();

    if (!meta.width || !meta.height) {
      throw new ValidationError('Unable to read image dimensions');
    }
    if (meta.width * meta.height > this.maxPixels) {
      throw new ValidationError(`Image pixel count exceeds maximum ${this.maxPixels}`);
    }
    signal?.throwIfAborted();

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
    const match = dataUri.match(/^data:image\/(?:jpeg|png|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match || !match[1]) {
      throw new ValidationError('Invalid base64 image data URI');
    }
    const encoded = match[1];
    if (encoded.length % 4 !== 0 || encoded.length > Math.ceil(this.maxSizeBytes / 3) * 4 + 4) {
      throw new ValidationError('Invalid or oversized base64 image data URI');
    }
    const decoded = Buffer.from(encoded, 'base64');
    if (decoded.toString('base64') !== encoded) {
      throw new ValidationError('Invalid base64 image data URI');
    }
    return decoded;
  }

  private async fromUrl(url: string, signal?: AbortSignal): Promise<Buffer> {
    await this.assertUrlSafe(url);

    const timeout = AbortSignal.timeout(this.fetchTimeoutMs);
    const response = await fetch(url, {
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    }).catch((error: unknown) => {
      if (signal?.aborted) throw signal.reason;
      throw new ValidationError(`Failed to fetch image from URL: ${(error as Error).message}`);
    });
    if (!response.ok) {
      throw new ValidationError(`Failed to fetch image from URL: HTTP ${response.status}`);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const bytes = Number(contentLength);
      if (Number.isFinite(bytes) && bytes > this.maxSizeBytes) {
        throw new ValidationError('Image from URL exceeds size limit');
      }
    }

    const data = await this.readResponseWithLimit(response);
    return data;
  }

  private async readResponseWithLimit(response: Response): Promise<Buffer> {
    if (!response.body) {
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > this.maxSizeBytes) {
        throw new ValidationError('Image from URL exceeds size limit');
      }
      return data;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > this.maxSizeBytes) {
          throw new ValidationError('Image from URL exceeds size limit');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
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
      hostname = parsed.hostname.replace(/^\[|\]$/g, '');
      protocol = parsed.protocol;
      if (parsed.username || parsed.password) {
        throw new ValidationError('URL credentials are not allowed');
      }
      if (parsed.port) {
        throw new ValidationError('Explicit URL ports are not allowed');
      }
    } catch {
      throw new ValidationError('Invalid URL');
    }

    // Only allow http/https
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new ValidationError(`Unsupported URL protocol: ${protocol}. Only http and https are allowed.`);
    }

    if (!hostname) throw new ValidationError('Invalid URL: no hostname');

    // If hostname is already an IP, check it directly
    const addresses: string[] = [];
    if (ipaddr.isValid(hostname)) {
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
    try {
      let address = ipaddr.parse(ip);
      if (address.kind() === 'ipv6') {
        const ipv6 = address as ipaddr.IPv6;
        if (ipv6.isIPv4MappedAddress()) address = ipv6.toIPv4Address();
      }
      return address.range() !== 'unicast';
    } catch {
      return true;
    }
  }
}
