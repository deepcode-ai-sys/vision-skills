/**
 * Shared Google Gemini API helper.
 *
 * Gemini has a FREE tier (Google AI Studio, no credit card). A single VLM
 * covers OCR, detection (with bounding boxes), and reasoning.
 *
 * generateContent API:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}
 *
 * Gemini 2.0 returns bounding boxes as [ymin, xmin, ymax, xmax] normalized
 * to 0-1000. Helpers here convert to our [x1,y1,x2,y2] pixel format.
 */

import { ProviderError } from '../../core/errors.js';
import type { GeminiKeyPool } from './key-pool.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** HTTP status codes worth retrying (transient). */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface GeminiRetryOptions {
  /** Max attempts (including the first). Default 3. */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff. Default 500. */
  baseDelayMs?: number;
  /** Max delay cap in ms. Default 8000. */
  maxDelayMs?: number;
}

export interface GeminiCallOptions {
  /** Single key. Ignored if `keyPool` is provided. */
  apiKey?: string;
  /** Optional key pool for rotation across many keys on 429. */
  keyPool?: GeminiKeyPool;
  model: string;
  prompt: string;
  imageBase64: string;
  /** MIME type of the image bytes. Defaults to 'image/jpeg'. */
  mimeType?: string;
  timeoutMs?: number;
  /** Ask Gemini to return JSON (sets responseMimeType). */
  jsonOutput?: boolean;
  retry?: GeminiRetryOptions;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute backoff delay for an attempt (exponential + jitter). If the server
 * sent a Retry-After header, honor it (seconds or HTTP-date).
 */
function backoffDelay(
  attempt: number,
  base: number,
  cap: number,
  retryAfter: string | null,
): number {
  if (retryAfter) {
    const asSeconds = Number(retryAfter);
    if (!Number.isNaN(asSeconds)) return Math.min(asSeconds * 1000, cap);
    const asDate = Date.parse(retryAfter);
    if (!Number.isNaN(asDate)) return Math.min(Math.max(0, asDate - Date.now()), cap);
  }
  const exp = Math.min(base * 2 ** attempt, cap);
  const jitter = Math.random() * base; // full jitter up to base
  return Math.min(exp + jitter, cap);
}

function parseRetryAfterMs(retryAfter: string | null): number | undefined {
  if (!retryAfter) return undefined;
  const asSeconds = Number(retryAfter);
  if (!Number.isNaN(asSeconds)) return asSeconds * 1000;
  const asDate = Date.parse(retryAfter);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return undefined;
}

/** Call Gemini generateContent with an image + prompt, return the text. */
export async function callGemini(opts: GeminiCallOptions): Promise<string> {
  const { keyPool, model, prompt, imageBase64, mimeType, timeoutMs = 20000, jsonOutput } = opts;
  const baseDelay = opts.retry?.baseDelayMs ?? 500;
  const maxDelay = opts.retry?.maxDelayMs ?? 8000;

  // With a key pool, allow enough attempts to cycle past bad/limited keys and
  // reach a working one. Cap generously (pools can contain many dead keys).
  const defaultAttempts = keyPool && keyPool.size > 1 ? Math.min(keyPool.size, 20) : 3;
  const maxAttempts = opts.retry?.maxAttempts ?? defaultAttempts;

  const body: Record<string, unknown> = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mimeType ?? 'image/jpeg', data: imageBase64 } },
          { text: prompt },
        ],
      },
    ],
  };
  if (jsonOutput) {
    body.generationConfig = { responseMimeType: 'application/json' };
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Pick a key: from the pool (rotating) or the single provided key.
    const key = keyPool ? keyPool.next() : opts.apiKey;
    if (!key) {
      throw new ProviderError('No Gemini API key available', 'gemini');
    }
    const url = `${BASE}/${model}:generateContent?key=${key}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Network error / timeout (e.g. a hanging key). Penalize so this key
      // is deprioritized, then move on to another key immediately.
      lastError = err as Error;
      keyPool?.penalize(key);
      if (attempt < maxAttempts - 1) {
        // With a pool, rotate right away (no long backoff); otherwise back off.
        await sleep(keyPool ? 0 : backoffDelay(attempt, baseDelay, maxDelay, null));
        continue;
      }
      throw new ProviderError(
        `Gemini request failed after ${maxAttempts} attempts: ${lastError.message}`,
        'gemini',
        lastError,
      );
    }

    if (response.ok) {
      const result = (await response.json()) as Record<string, unknown>;
      keyPool?.reward(key);
      return extractText(result);
    }

    const text = await response.text();
    const status = response.status;
    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));

    // Per-key failures with a key pool: 429 (rate limit), 404/403/400 (bad or
    // unauthorized key). Penalize this key and rotate to another immediately.
    // Rotation is the whole point of the pool — one bad key must not fail the
    // request when other keys work.
    const KEY_SPECIFIC = status === 429 || status === 404 || status === 403 || status === 400;
    if (KEY_SPECIFIC && keyPool) {
      // 404/403/400 = likely permanently bad key → long cooldown so we stop
      // wasting attempts on it. 429 = transient rate limit → normal cooldown.
      const cooldown = status === 429 ? retryAfterMs : 24 * 60 * 60 * 1000;
      keyPool.penalize(key, cooldown);
      lastError = new Error(`HTTP ${status} (key rotated): ${text.slice(0, 120)}`);
      if (attempt < maxAttempts - 1) {
        await sleep(keyPool.availableCount() > 0 ? 0 : Math.min(baseDelay, maxDelay));
        continue;
      }
    }

    // Other transient errors: exponential backoff on the same/next key.
    if (RETRYABLE_STATUS.has(status) && attempt < maxAttempts - 1) {
      const delay = backoffDelay(attempt, baseDelay, maxDelay, response.headers.get('retry-after'));
      lastError = new Error(`HTTP ${status}: ${text.slice(0, 200)}`);
      await sleep(delay);
      continue;
    }

    throw new ProviderError(`Gemini returned HTTP ${status}: ${text.slice(0, 200)}`, 'gemini');
  }

  throw new ProviderError(
    `Gemini request failed after ${maxAttempts} attempts: ${lastError?.message ?? 'unknown'}`,
    'gemini',
  );
}

function extractText(result: Record<string, unknown>): string {
  const candidates = result.candidates as Array<Record<string, unknown>> | undefined;
  if (!candidates || candidates.length === 0) {
    // Could be blocked by safety filters
    const feedback = result.promptFeedback as Record<string, unknown> | undefined;
    if (feedback?.blockReason) {
      throw new ProviderError(`Gemini blocked: ${feedback.blockReason}`, 'gemini');
    }
    return '';
  }
  const content = candidates[0]!.content as Record<string, unknown> | undefined;
  const parts = (content?.parts as Array<Record<string, unknown>>) ?? [];
  return parts.map((p) => (p.text as string) ?? '').join('');
}

/** Strip markdown code fences from a model response. */
export function stripFences(raw: string): string {
  let text = raw.trim();
  if (text.startsWith('```')) {
    const parts = text.split('```');
    if (parts.length >= 2) {
      text = parts[1]!.replace(/^json/i, '').trim();
    }
  }
  return text;
}

/**
 * Convert a Gemini bounding box [ymin, xmin, ymax, xmax] (0-1000 normalized)
 * to our [x1, y1, x2, y2] pixel format.
 */
export function geminiBoxToPixels(
  box: number[],
  width: number,
  height: number,
): [number, number, number, number] {
  if (box.length !== 4) return [0, 0, 0, 0];
  const [ymin, xmin, ymax, xmax] = box as [number, number, number, number];
  return [
    Math.round((xmin / 1000) * width * 10) / 10,
    Math.round((ymin / 1000) * height * 10) / 10,
    Math.round((xmax / 1000) * width * 10) / 10,
    Math.round((ymax / 1000) * height * 10) / 10,
  ];
}
