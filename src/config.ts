/**
 * Configuration for Vision Skills.
 *
 * Settings are provided programmatically via the SDK constructor, with
 * environment-variable fallbacks for the optional server.
 */

import { z } from 'zod';

import { ConfigurationError } from './core/errors.js';
import { REQUESTED_MODES, type RequestedMode } from './core/types.js';
import type { CacheBackend } from './cache/cache.js';
import {
  SPECIALIST_CAPABILITIES,
  SPECIALIST_PROTOCOLS,
  type SpecialistsConfig,
} from './specialists/types.js';

export interface VisionSkillsConfig {
  // Provider credentials
  geminiApiKey?: string; // FREE tier at Google AI Studio (no credit card)
  /** Multiple Gemini keys for rotation (bypasses per-key free-tier limits). */
  geminiApiKeys?: string[];

  // VLM
  vlmProvider?: 'gemini';
  geminiModel?: string;

  // Behavior
  defaultMode?: RequestedMode;
  enableSemanticRelationships?: boolean;
  enableReasoner?: boolean;
  /**
   * Analysis depth for reading:
   * - 'fast': single whole-image pass (cheapest, may miss small text).
   * - 'deep': also tiles large/dense images for thorough, stable reading
   *   (more API calls, but consistent results). Default 'fast'.
   */
  analysisDepth?: 'fast' | 'deep';

  // Image processing
  maxImageSizeMb?: number;
  maxDimension?: number;
  maxImagePixels?: number;
  imageFetchTimeoutMs?: number;
  jpegQuality?: number;

  // Cache
  cacheEnabled?: boolean;
  cacheTtlSeconds?: number;
  cacheBackend?: CacheBackend;

  // Classifier thresholds
  classifierFinalThreshold?: number;

  // Scene graph spatial thresholds (fraction of image dimension)
  spatialThresholdX?: number;
  spatialThresholdY?: number;
  spatialNearThreshold?: number;
  spatialOverlapIouThreshold?: number;

  // Use mock providers (for testing without API keys)
  useMockProviders?: boolean;

  /** Opt-in specialist providers and explicit per-capability routes. */
  specialists?: SpecialistsConfig;
}

export interface ResolvedConfig extends Required<Omit<VisionSkillsConfig,
  'geminiApiKey' | 'geminiApiKeys' | 'cacheBackend' | 'specialists'>> {
  geminiApiKey?: string;
  /** Resolved, de-duplicated list of all Gemini keys (single + array + env). */
  geminiApiKeys: string[];
  cacheBackend?: CacheBackend;
  specialists?: SpecialistsConfig;
}

const specialistProviderSchema = z.object({
  id: z.string().min(1).regex(/^[A-Za-z0-9._-]+$/),
  protocol: z.enum(SPECIALIST_PROTOCOLS),
  endpoint: z.string().url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'Endpoint must use HTTP or HTTPS'),
  capabilities: z.array(z.enum(SPECIALIST_CAPABILITIES)).min(1),
  model: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  headers: z.record(z.string().min(1)).optional(),
  timeoutMs: z.number().int().positive().max(300_000).optional(),
  maxResponseBytes: z.number().int().positive().max(100_000_000).optional(),
}).strict().superRefine((provider, context) => {
  if (provider.protocol === 'openai-chat-completions' && !provider.model) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'openai-chat-completions provider requires model' });
  }
  const headerNames = Object.keys(provider.headers ?? {}).map((key) => key.toLowerCase());
  if (headerNames.includes('content-length') || headerNames.includes('host')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Specialist headers cannot override Host or Content-Length' });
  }
});

const specialistsSchema = z.object({
  providers: z.array(specialistProviderSchema).min(1),
  routes: z.record(z.enum(SPECIALIST_CAPABILITIES), z.object({
    providers: z.array(z.string().min(1)).min(1),
    mode: z.enum(['augment', 'replace']),
  }).strict()).refine((routes) => Object.keys(routes).length > 0, 'At least one specialist route is required'),
}).strict();

const configSchema = z.object({
  geminiApiKey: z.string().min(1).optional(),
  geminiApiKeys: z.array(z.string().min(1)).optional(),
  vlmProvider: z.literal('gemini').optional(),
  geminiModel: z.string().min(1).optional(),
  defaultMode: z.enum(REQUESTED_MODES).optional(),
  enableSemanticRelationships: z.boolean().optional(),
  enableReasoner: z.boolean().optional(),
  analysisDepth: z.enum(['fast', 'deep']).optional(),
  maxImageSizeMb: z.number().positive().finite().optional(),
  maxDimension: z.number().int().positive().optional(),
  maxImagePixels: z.number().int().positive().optional(),
  imageFetchTimeoutMs: z.number().int().positive().optional(),
  jpegQuality: z.number().int().min(1).max(100).optional(),
  cacheEnabled: z.boolean().optional(),
  cacheTtlSeconds: z.number().int().positive().optional(),
  cacheBackend: z.object({
    get: z.function(), set: z.function(), delete: z.function(), clear: z.function(),
  }).optional(),
  classifierFinalThreshold: z.number().min(0).max(1).finite().optional(),
  spatialThresholdX: z.number().min(0).finite().optional(),
  spatialThresholdY: z.number().min(0).finite().optional(),
  spatialNearThreshold: z.number().min(0).finite().optional(),
  spatialOverlapIouThreshold: z.number().min(0).max(1).finite().optional(),
  useMockProviders: z.boolean().optional(),
  specialists: specialistsSchema.optional(),
}).strict();

export function resolveConfig(config: VisionSkillsConfig = {}): ResolvedConfig {
  const parsed = configSchema.safeParse(config);
  if (!parsed.success) {
    throw new ConfigurationError(`Invalid configuration: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string>;

  // Collect all Gemini keys: single key + array + env (single or comma list).
  const envKeys = (env.GEMINI_API_KEYS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const allGeminiKeys = [
    ...(config.geminiApiKeys ?? []),
    ...(config.geminiApiKey ? [config.geminiApiKey] : []),
    ...(env.GEMINI_API_KEY ? [env.GEMINI_API_KEY] : []),
    ...envKeys,
  ]
    .map((k) => k.trim())
    .filter(Boolean);
  const dedupedKeys = [...new Set(allGeminiKeys)];

  return {
    geminiApiKey: dedupedKeys[0],
    geminiApiKeys: dedupedKeys,
    vlmProvider: 'gemini',
    geminiModel: config.geminiModel ?? 'gemini-flash-lite-latest',
    defaultMode: config.defaultMode ?? 'auto',
    enableSemanticRelationships: config.enableSemanticRelationships ?? true,
    enableReasoner: config.enableReasoner ?? true,
    analysisDepth: config.analysisDepth ?? 'fast',
    maxImageSizeMb: config.maxImageSizeMb ?? 10,
    maxDimension: config.maxDimension ?? 2048,
    maxImagePixels: config.maxImagePixels ?? 40_000_000,
    imageFetchTimeoutMs: config.imageFetchTimeoutMs ?? 15_000,
    jpegQuality: config.jpegQuality ?? 85,
    cacheEnabled: config.cacheEnabled ?? true,
    cacheTtlSeconds: config.cacheTtlSeconds ?? 3600,
    cacheBackend: config.cacheBackend,
    classifierFinalThreshold: config.classifierFinalThreshold ?? 0.6,
    spatialThresholdX: config.spatialThresholdX ?? 0.05,
    spatialThresholdY: config.spatialThresholdY ?? 0.05,
    spatialNearThreshold: config.spatialNearThreshold ?? 0.15,
    spatialOverlapIouThreshold: config.spatialOverlapIouThreshold ?? 0.1,
    useMockProviders: config.useMockProviders ?? false,
    specialists: parsed.data.specialists,
  };
}
