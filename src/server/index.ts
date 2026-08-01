/** Optional hardened REST adapter. Import from `vision-skills/server`. */

import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { VisionSkills } from '../vision-skills.js';
import type { VisionSkillsConfig } from '../config.js';
import { REQUESTED_MODES, type ImageInput } from '../core/types.js';
import { VisionSkillsError } from '../core/errors.js';
import { boundOutput } from '../utils/output.js';

const analyzeBodySchema = z.object({
  image: z.string().min(1),
  mode: z.enum(REQUESTED_MODES).optional(),
  enableReasoner: z.boolean().optional(),
}).strict();

export interface ServerOptions {
  config?: VisionSkillsConfig;
  vision?: VisionSkills;
  /** Required remotely. Defaults to `VSKILLS_API_KEY`; loopback may remain keyless. */
  apiKey?: string;
  allowUnauthenticatedLoopback?: boolean;
  allowRemoteLocalPaths?: boolean;
  corsOrigins?: string[];
  maxConcurrentRequests?: number;
  requestTimeoutMs?: number;
  maxOutputChars?: number;
  bodyLimit?: number;
  logger?: boolean;
}

function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (normalized === '::1') return true;
  if (isIP(normalized) !== 4) return false;
  return normalized.startsWith('127.');
}

function keysEqual(expected: string, provided: string): boolean {
  const expectedHash = createHash('sha256').update(expected).digest();
  const providedHash = createHash('sha256').update(provided).digest();
  return timingSafeEqual(expectedHash, providedHash);
}

function createAuthHook(apiKey: string | undefined, allowLoopback: boolean) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (allowLoopback && isLoopback(request.ip)) return;
    if (!apiKey) {
      return reply.status(503).send({ error: 'Remote API access is disabled until VSKILLS_API_KEY is configured' });
    }
    const header = request.headers['x-api-key'];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!provided || !keysEqual(apiKey, provided)) {
      return reply.status(401).send({ error: 'Invalid or missing API key' });
    }
  };
}

function isLocalPath(value: string): boolean {
  return !/^https?:\/\//i.test(value) && !/^data:image\//i.test(value);
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

export function registerRoutes(app: FastifyInstance, options: ServerOptions = {}): VisionSkills {
  const vision = options.vision ?? new VisionSkills(options.config);
  const apiKey = options.apiKey ?? process.env.VSKILLS_API_KEY;
  const auth = createAuthHook(apiKey, options.allowUnauthenticatedLoopback ?? true);
  const maxConcurrent = options.maxConcurrentRequests ?? 4;
  const timeoutMs = options.requestTimeoutMs ?? 120_000;
  const maxOutputChars = options.maxOutputChars ?? 2_000_000;
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) throw new RangeError('maxConcurrentRequests must be a positive safe integer');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new RangeError('requestTimeoutMs must be a positive safe integer');
  if (!Number.isSafeInteger(maxOutputChars) || maxOutputChars < 0) throw new RangeError('maxOutputChars must be a non-negative safe integer');
  let active = 0;

  if (options.corsOrigins?.length) {
    const origins = new Set(options.corsOrigins);
    const allowedMethods = new Set(['GET', 'POST', 'DELETE', 'OPTIONS']);
    const allowedHeaders = new Set(['content-type', 'x-api-key']);
    app.options('*', async (request, reply) => {
      const origin = request.headers.origin;
      if (typeof origin !== 'string' || !origins.has(origin)) {
        return reply.status(403).send({ error: 'CORS origin is not allowed' });
      }
      const requestedMethod = request.headers['access-control-request-method']?.toUpperCase();
      const requestedHeaders = String(request.headers['access-control-request-headers'] ?? '')
        .split(',').map((header) => header.trim().toLowerCase()).filter(Boolean);
      if (!requestedMethod || !allowedMethods.has(requestedMethod) || requestedHeaders.some((header) => !allowedHeaders.has(header))) {
        return reply.status(400).send({ error: 'CORS preflight method or headers are not allowed' });
      }
      return reply
        .header('Access-Control-Allow-Origin', origin)
        .header('Vary', 'Origin')
        .header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        .header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key')
        .header('Access-Control-Max-Age', '600')
        .status(204).send();
    });
    app.addHook('onRequest', async (request, reply) => {
      const origin = request.headers.origin;
      if (typeof origin === 'string' && origins.has(origin)) {
        reply.header('Access-Control-Allow-Origin', origin);
        reply.header('Vary', 'Origin');
        reply.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
      }
    });
  }

  app.get('/health', async () => ({ status: 'live', live: true }));
  app.get('/ready', async (_request, reply) => {
    const providers = await vision.healthCheck();
    const ready = Object.values(providers).some(Boolean);
    return reply.status(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not_ready', ready, providers });
  });
  app.get('/v1/health/providers', { preHandler: auth }, async () => vision.healthCheck());
  app.get('/v1/cache/stats', { preHandler: auth }, async () => vision.cacheStats());
  app.delete('/v1/cache', { preHandler: auth }, async () => ({
    message: 'Cache cleared', entriesRemoved: await vision.clearCache(),
  }));

  app.post('/v1/analyze', { preHandler: auth }, async (request, reply) => {
    const parsed = analyzeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    }
    if (active >= maxConcurrent) {
      return reply.status(429).header('Retry-After', '1').send({ error: 'Analysis concurrency limit reached' });
    }
    const remote = !isLoopback(request.ip);
    if (remote && isLocalPath(parsed.data.image) && !options.allowRemoteLocalPaths) {
      return reply.status(400).send({ error: 'Local image paths are not accepted from remote clients' });
    }

    active += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Request timeout')), timeoutMs);
    const disconnected = () => controller.abort(new Error('Client disconnected'));
    request.raw.once('aborted', disconnected);
    const responseClosed = () => {
      if (!reply.raw.writableFinished) disconnected();
    };
    reply.raw.once('close', responseClosed);
    const analysis = Promise.resolve().then(() => vision.analyze(parsed.data.image as ImageInput, {
      mode: parsed.data.mode,
      enableReasoner: parsed.data.enableReasoner,
      signal: controller.signal,
    }));
    void analysis.finally(() => { active -= 1; }).catch(() => undefined);
    try {
      const result = await Promise.race([
        analysis,
        abortPromise(controller.signal),
      ]);
      const output = boundOutput(result, maxOutputChars);
      return output.data ?? output;
    } catch (error) {
      if (controller.signal.aborted) {
        return reply.status(504).send({ error: 'Analysis request timed out or was cancelled' });
      }
      if (error instanceof VisionSkillsError) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code });
      }
      request.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    } finally {
      clearTimeout(timeout);
      request.raw.off('aborted', disconnected);
      reply.raw.off('close', responseClosed);
    }
  });

  return vision;
}

export async function createServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const { default: Fastify } = await import('fastify');
  const maxImageMb = options.config?.maxImageSizeMb ?? 10;
  const derivedBodyLimit = Math.ceil(maxImageMb * 1024 * 1024 * 4 / 3) + 64 * 1024;
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: options.bodyLimit ?? derivedBodyLimit });
  registerRoutes(app, options);
  return app;
}
