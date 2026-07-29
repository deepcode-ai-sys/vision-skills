/**
 * Optional REST server for Vision Skills.
 *
 * Exposes the SDK over HTTP. Fastify is a peer dependency - only needed if
 * you use the server. Import from 'vision-skills/server'.
 */

import type { FastifyInstance } from 'fastify';

import { VisionSkills } from '../vision-skills.js';
import type { VisionSkillsConfig } from '../config.js';
import type { ImageInput, ProcessingMode } from '../core/types.js';
import { VisionSkillsError } from '../core/errors.js';

export interface ServerOptions {
  config?: VisionSkillsConfig;
  /** Pre-built VisionSkills instance (overrides config). */
  vision?: VisionSkills;
}

interface AnalyzeBody {
  image: string;
  mode?: ProcessingMode;
  enableReasoner?: boolean;
}

/**
 * Register Vision Skills routes on a Fastify instance.
 *
 * @example
 * ```ts
 * import Fastify from 'fastify';
 * import { registerRoutes } from 'vision-skills/server';
 *
 * const app = Fastify();
 * registerRoutes(app, { config: { googleCloudVisionKey: '...' } });
 * await app.listen({ port: 8000 });
 * ```
 */
export function registerRoutes(app: FastifyInstance, options: ServerOptions = {}): VisionSkills {
  const vision = options.vision ?? new VisionSkills(options.config);

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/v1/health/providers', async () => vision.healthCheck());

  app.get('/v1/cache/stats', async () => vision.cacheStats());

  app.post<{ Body: AnalyzeBody }>('/v1/analyze', async (request, reply) => {
    try {
      const { image, mode, enableReasoner } = request.body;
      if (!image || typeof image !== 'string') {
        return reply.status(400).send({ error: 'Missing or invalid "image" field' });
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

/**
 * Build a ready-to-listen Fastify app with Vision Skills routes.
 * Requires fastify to be installed.
 */
export async function createServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const { default: Fastify } = await import('fastify');
  const app = Fastify({ logger: true });
  registerRoutes(app, options);
  return app;
}
