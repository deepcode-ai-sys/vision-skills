import { ProviderError } from '../core/errors.js';
import type { SpecialistCanonicalOutput, SpecialistCapability, SpecialistProviderConfig } from './types.js';
import { createSpecialistCodec } from './codecs.js';
import sharp from 'sharp';

export interface SpecialistProvider {
  readonly id: string;
  readonly capabilities: ReadonlySet<SpecialistCapability>;
  call(image: Buffer, capabilities: SpecialistCapability[], signal?: AbortSignal): Promise<SpecialistCanonicalOutput>;
}

const REDACTED_HEADERS = new Set(['authorization', 'proxy-authorization', 'x-api-key', 'api-key']);

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key, REDACTED_HEADERS.has(key.toLowerCase()) ? '[REDACTED]' : value,
  ]));
}

async function readLimitedJson(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body) throw new Error('Provider returned an empty response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Provider response exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('Provider response is not valid JSON'); }
}

export class HttpSpecialistProvider implements SpecialistProvider {
  readonly id: string;
  readonly capabilities: ReadonlySet<SpecialistCapability>;
  private readonly codec;

  constructor(private readonly config: SpecialistProviderConfig) {
    this.id = config.id;
    this.capabilities = new Set(config.capabilities);
    this.codec = createSpecialistCodec(config.protocol);
  }

  async call(image: Buffer, capabilities: SpecialistCapability[], signal?: AbortSignal) {
    for (const capability of capabilities) {
      if (!this.capabilities.has(capability)) {
        throw new ProviderError(`Provider '${this.id}' does not support '${capability}'`, this.id);
      }
    }
    const timeout = AbortSignal.timeout(this.config.timeoutMs ?? 15_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const headers: Record<string, string> = { 'content-type': 'application/json', ...this.config.headers };
    if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;
    let response: Response;
    try {
      response = await fetch(this.config.endpoint, {
        method: 'POST', headers, body: JSON.stringify(this.codec.encode(image, capabilities, this.config.model)),
        redirect: 'error', signal: combined,
      });
    } catch (error) {
      throw new ProviderError(`Specialist request failed for '${this.id}': ${(error as Error).message}`, this.id, error as Error);
    }
    if (!response.ok) {
      throw new ProviderError(`Specialist '${this.id}' returned HTTP ${response.status}`, this.id);
    }
    try {
      const value = await readLimitedJson(response, this.config.maxResponseBytes ?? 5_000_000);
      if (this.config.protocol !== 'omniparser-v2') return this.codec.decode(value);
      const metadata = await sharp(image).metadata();
      return this.codec.decode(value, metadata.width && metadata.height
        ? { width: metadata.width, height: metadata.height }
        : undefined);
    } catch (error) {
      throw new ProviderError(`Invalid ${this.config.protocol} response from '${this.id}': ${(error as Error).message}`, this.id, error as Error);
    }
  }
}
