/**
 * Optional REST server for Vision Skills.
 *
 * Exposes the SDK over HTTP. Fastify is a peer dependency - only needed if
 * you use the server. Import from 'vision-skills/server'.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { VisionSkills } from '../vision-skills.js';
import type { VisionSkillsConfig } from '../config.js';
import type { ImageInput, ProcessingMode } from '../core/types.js';
import { VisionSkillsError, AuthenticationError } from '../core/errors.js';

export interface ServerOptions {
  config?: VisionSkillsConfig;
  /** Pre-built VisionSkills instance (overrides config). */
  vision?: VisionSkills;
  /** API key required for all endpoints (default: check env VSKILLS_API_KEY). */
  apiKey?: string;
  /** Allowed CORS origins. Default: none (same-origin only). */
  corsOrigins?: string[];
}

interface AnalyzeBody {
  image: string;
  mode?: ProcessingMode;
  enableReasoner?: boolean;
}

function createAuthHook(apiKey: string | undefined) {
  return async (request: FastifyRequest) => {
    if (!apiKey) return; // No auth configured
    const provided = request.headers['x-api-key'] as string | undefined;
    if (!provided || provided !== apiKey) {
      throw new AuthenticationError('Invalid or missing API key. Provide via X-API-Key header.');
    }
  };
}

export function registerRoutes(app: FastifyInstance, options: ServerOptions = {}): VisionSkills {
  const vision = options.vision ?? new VisionSkills(options.config);
  const apiKey = options.apiKey ?? process.env.VSKILLS_API_KEY;
  const auth = createAuthHook(apiKey);

  // CORS whitelist
  if (options.corsOrigins && options.corsOrigins.length > 0) {
    // Register CORS if origins provided
    const origins = options.corsOrigins;
    app.addHook('onRequest', async (request, reply) => {
      const origin = request.headers.origin as string | undefined;
      if (origin && origins.includes(origin)) {
        reply.header('Access-Control-Allow-Origin', origin);
        reply.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
      }
    });
  }

  // Health check (no auth required)
  app.get('/health', async () => ({ status: 'ok', version: '3.1.0' }));

  // All other endpoints require auth if configured
  app.get('/v1/health/providers', { preHandler: auth }, async () => vision.healthCheck());

  app.get('/v1/cache/stats', { preHandler: auth }, async () => vision.cacheStats());

  app.delete('/v1/cache', { preHandler: auth }, async () => {
    const count = await vision.clearCache();
    return { message: 'Cache cleared', entriesRemoved: count };
  });

  app.post<{ Body: AnalyzeBody }>('/v1/analyze', { preHandler: auth }, async (request, reply) => {
    try {
      const { image, mode, enableReasoner } = request.body;
      if (!image || typeof image !== 'string') {
        return reply.status(400).send({ error: 'Missing or invalid "image" field' });
      }
      if (image.length > 100 * 1024 * 1024) {
        return reply.status(413).send({ error: 'Image data too large' });
      }
      const result = await vision.analyze(image as ImageInput, { mode, enableReasoner });
      return result;
    } catch (err) {
      if (err instanceof VisionSkillsError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code });
      }
      request.log.error(err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  return vision;
}

export async function createServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const { default: Fastify } = await import('fastify');
  const app = Fastify({ logger: true, bodyLimit: 110 * 1024 * 1024 });
  registerRoutes(app, options);
  return app;
}
