import { describe, it, expect, vi, afterEach } from 'vitest';

import { callGemini } from '../src/plugins/gemini/client.js';
import { ProviderError } from '../src/core/errors.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockResponse(status: number, body: string, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as Response;
}

const okBody = JSON.stringify({
  candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
});

describe('callGemini retry/backoff', () => {
  it('returns on first success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, okBody));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const text = await callGemini({
      apiKey: 'k',
      model: 'm',
      prompt: 'p',
      imageBase64: 'x',
      retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
    });
    expect(text).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(429, 'rate limited', { 'retry-after': '0' }))
      .mockResolvedValueOnce(mockResponse(200, okBody));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const text = await callGemini({
      apiKey: 'k',
      model: 'm',
      prompt: 'p',
      imageBase64: 'x',
      retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
    });
    expect(text).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on 503 up to maxAttempts then throws', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(503, 'unavailable'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      callGemini({
        apiKey: 'k',
        model: 'm',
        prompt: 'p',
        imageBase64: 'x',
        retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
      }),
    ).rejects.toThrow(ProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on 400 (client error)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(400, 'bad request'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      callGemini({
        apiKey: 'k',
        model: 'm',
        prompt: 'p',
        imageBase64: 'x',
        retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
      }),
    ).rejects.toThrow(/HTTP 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on network error then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(mockResponse(200, okBody));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const text = await callGemini({
      apiKey: 'k',
      model: 'm',
      prompt: 'p',
      imageBase64: 'x',
      retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
    });
    expect(text).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
