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
  googleCloudVisionKey?: string; // paid
  anthropicApiKey?: string; // paid

  // VLM
  vlmProvider?: 'gemini' | 'claude';
  geminiModel?: string;
  claudeModel?: string;

  // Behavior
  defaultMode?: ProcessingMode;
  enableSemanticRelationships?: boolean;
  enableReasoner?: boolean;

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
  'geminiApiKey' | 'googleCloudVisionKey' | 'anthropicApiKey'>> {
  geminiApiKey?: string;
  googleCloudVisionKey?: string;
  anthropicApiKey?: string;
}

export function resolveConfig(config: VisionSkillsConfig = {}): ResolvedConfig {
  const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string>;

  return {
    geminiApiKey: config.geminiApiKey ?? env.GEMINI_API_KEY,
    googleCloudVisionKey: config.googleCloudVisionKey ?? env.GOOGLE_CLOUD_VISION_KEY,
    anthropicApiKey: config.anthropicApiKey ?? env.ANTHROPIC_API_KEY,
    vlmProvider: config.vlmProvider ?? 'gemini',
    geminiModel: config.geminiModel ?? 'gemini-2.0-flash',
    claudeModel: config.claudeModel ?? 'claude-3-5-sonnet-20241022',
    defaultMode: config.defaultMode ?? 'standard',
    enableSemanticRelationships: config.enableSemanticRelationships ?? true,
    enableReasoner: config.enableReasoner ?? true,
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
