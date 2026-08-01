import { request as httpRequest } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createServer } from '../src/server/index.js';

const result = { imageType: 'document', entities: [] };

describe('REST server', () => {
  it('supports loopback development and validates bodies', async () => {
    const vision = { analyze: vi.fn().mockResolvedValue(result), healthCheck: vi.fn().mockResolvedValue({ mock: true }), cacheStats: vi.fn(), clearCache: vi.fn() } as any;
    const app = await createServer({ vision, logger: false });
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ status: 'live', live: true });
    expect((await app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/v1/analyze', payload: { image: 'x', extra: true } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/analyze', payload: { image: 'x', mode: 'basic' } })).json()).toEqual(result);
    await app.close();
  });

  it('requires a timing-safe API key and rejects remote local paths', async () => {
    const vision = { analyze: vi.fn().mockResolvedValue(result), healthCheck: vi.fn(), cacheStats: vi.fn(), clearCache: vi.fn() } as any;
    const app = await createServer({ vision, apiKey: 'secret', allowUnauthenticatedLoopback: false, logger: false });
    await app.ready();
    const remoteAddress = '203.0.113.10';
    expect((await app.inject({ method: 'POST', url: '/v1/analyze', remoteAddress, payload: { image: 'x' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/analyze', remoteAddress, headers: { 'x-api-key': 'secret' }, payload: { image: 'x' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/analyze', remoteAddress, headers: { 'x-api-key': 'secret' }, payload: { image: 'https://example.com/a.png' } })).statusCode).toBe(200);
    await app.close();
  });

  it('enforces concurrency and request timeouts', async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => { resolve = done; });
    const vision = { analyze: vi.fn().mockReturnValue(pending), healthCheck: vi.fn(), cacheStats: vi.fn(), clearCache: vi.fn() } as any;
    const app = await createServer({ vision, maxConcurrentRequests: 1, requestTimeoutMs: 20, logger: false });
    await app.ready();
    const first = app.inject({ method: 'POST', url: '/v1/analyze', payload: { image: 'x' } });
    await new Promise((done) => setTimeout(done, 1));
    expect((await app.inject({ method: 'POST', url: '/v1/analyze', payload: { image: 'x' } })).statusCode).toBe(429);
    expect((await first).statusCode).toBe(504);
    expect((await app.inject({ method: 'POST', url: '/v1/analyze', payload: { image: 'x' } })).statusCode).toBe(429);
    resolve(result);
    await pending;
    await new Promise((done) => setTimeout(done, 0));
    expect((await app.inject({ method: 'POST', url: '/v1/analyze', payload: { image: 'x' } })).statusCode).toBe(200);
    await app.close();
  });

  it('aborts analysis on client socket close without releasing its slot early', async () => {
    let resolve!: (value: unknown) => void;
    let signal!: AbortSignal;
    const pending = new Promise((done) => { resolve = done; });
    const vision = { analyze: vi.fn((_image, options) => { signal = options.signal; return pending; }), healthCheck: vi.fn(), cacheStats: vi.fn(), clearCache: vi.fn() } as any;
    const app = await createServer({ vision, maxConcurrentRequests: 1, requestTimeoutMs: 10_000, logger: false });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    const req = httpRequest({ host: '127.0.0.1', port: address.port, path: '/v1/analyze', method: 'POST', headers: { 'content-type': 'application/json' } });
    req.on('error', () => undefined);
    req.end(JSON.stringify({ image: 'x' }));
    await vi.waitFor(() => expect(vision.analyze).toHaveBeenCalledOnce());
    req.destroy();
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
    expect((await app.inject({ method: 'POST', url: '/v1/analyze', payload: { image: 'x' } })).statusCode).toBe(429);
    resolve(result);
    await pending;
    await app.close();
  });

  it('implements allowlisted CORS preflight without reflecting untrusted input', async () => {
    const vision = { analyze: vi.fn(), healthCheck: vi.fn(), cacheStats: vi.fn(), clearCache: vi.fn() } as any;
    const app = await createServer({ vision, corsOrigins: ['https://client.example'], logger: false });
    await app.ready();
    const allowed = await app.inject({ method: 'OPTIONS', url: '/v1/analyze', headers: {
      origin: 'https://client.example',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'Content-Type, X-API-Key',
    } });
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://client.example');
    expect(allowed.headers['access-control-allow-methods']).toContain('POST');
    expect((await app.inject({ method: 'OPTIONS', url: '/v1/analyze', headers: {
      origin: 'https://evil.example', 'access-control-request-method': 'POST',
    } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'OPTIONS', url: '/v1/analyze', headers: {
      origin: 'https://client.example', 'access-control-request-method': 'PATCH',
    } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'OPTIONS', url: '/v1/analyze', headers: {
      origin: 'https://client.example', 'access-control-request-method': 'POST',
      'access-control-request-headers': 'X-Evil',
    } })).statusCode).toBe(400);
    await app.close();
  });

  it('accepts explicit auto and leaves omitted mode undefined for SDK defaults', async () => {
    const vision = { analyze: vi.fn().mockResolvedValue(result), healthCheck: vi.fn(), cacheStats: vi.fn(), clearCache: vi.fn() } as any;
    const app = await createServer({ vision, logger: false });
    await app.ready();
    await app.inject({ method: 'POST', url: '/v1/analyze', payload: { image: 'x' } });
    await app.inject({ method: 'POST', url: '/v1/analyze', payload: { image: 'x', mode: 'auto' } });
    expect(vision.analyze.mock.calls[0][1].mode).toBeUndefined();
    expect(vision.analyze.mock.calls[1][1].mode).toBe('auto');
    await app.close();
  });
});
