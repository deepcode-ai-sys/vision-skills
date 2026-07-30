/**
 * Configuration for Vision Skills.
 *
 * Settings are provided programmatically via the SDK constructor, with
 * environment-variable fallbacks for the optional server.
 */

import type { ProcessingMode } from './core/types.js';

export interface VisionSkillsConfig {
  // Provider credentials
  geminiApiKey?: string; // FREE tier at Google AI Studio (no credit card)
  /** Multiple Gemini keys for rotation (bypasses per-key free-tier limits). */
  geminiApiKeys?: string[];
  googleCloudVisionKey?: string; // paid

  // VLM
  vlmProvider?: 'gemini';
  geminiModel?: string;

  // Behavior
  defaultMode?: ProcessingMode;
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
  jpegQuality?: number;

  // Cache
  cacheEnabled?: boolean;
  cacheTtlSeconds?: number;

  // Classifier thresholds
  classifierFinalThreshold?: number;

  // Scene graph spatial thresholds (fraction of image dimension)
  spatialThresholdX?: number;
  spatialThresholdY?: number;
  spatialNearThreshold?: number;
  spatialOverlapIouThreshold?: number;

  // Use mock providers (for testing without API keys)
  useMockProviders?: boolean;
}

export interface ResolvedConfig extends Required<Omit<VisionSkillsConfig,
  'geminiApiKey' | 'geminiApiKeys' | 'googleCloudVisionKey'>> {
  geminiApiKey?: string;
  /** Resolved, de-duplicated list of all Gemini keys (single + array + env). */
  geminiApiKeys: string[];
  googleCloudVisionKey?: string;
}

export function resolveConfig(config: VisionSkillsConfig = {}): ResolvedConfig {
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
    googleCloudVisionKey: config.googleCloudVisionKey ?? env.GOOGLE_CLOUD_VISION_KEY,
    vlmProvider: 'gemini',
    geminiModel: config.geminiModel ?? 'gemini-flash-lite-latest',
    defaultMode: config.defaultMode ?? 'standard',
    enableSemanticRelationships: config.enableSemanticRelationships ?? true,
    enableReasoner: config.enableReasoner ?? true,
    analysisDepth: config.analysisDepth ?? 'fast',
    maxImageSizeMb: config.maxImageSizeMb ?? 10,
    maxDimension: config.maxDimension ?? 2048,
    jpegQuality: config.jpegQuality ?? 85,
    cacheEnabled: config.cacheEnabled ?? true,
    cacheTtlSeconds: config.cacheTtlSeconds ?? 3600,
    classifierFinalThreshold: config.classifierFinalThreshold ?? 0.6,
    spatialThresholdX: config.spatialThresholdX ?? 0.05,
    spatialThresholdY: config.spatialThresholdY ?? 0.05,
    spatialNearThreshold: config.spatialNearThreshold ?? 0.15,
    spatialOverlapIouThreshold: config.spatialOverlapIouThreshold ?? 0.1,
    useMockProviders: config.useMockProviders ?? false,
  };
}
