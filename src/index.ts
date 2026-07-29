/**
 * Vision Skills - public API.
 *
 * Turn images into structured JSON for text-only or vision-weak AI models.
 *
 * @example
 * ```ts
 * import { VisionSkills } from 'vision-skills';
 *
 * const vision = new VisionSkills({
 *   googleCloudVisionKey: process.env.GOOGLE_CLOUD_VISION_KEY,
 *   anthropicApiKey: process.env.ANTHROPIC_API_KEY,
 * });
 *
 * const result = await vision.analyze('./screenshot.png', { mode: 'standard' });
 * console.log(JSON.stringify(result, null, 2));
 * ```
 */

export { VisionSkills, type AnalyzeOptions } from './vision-skills.js';
export { type VisionSkillsConfig, resolveConfig } from './config.js';

// Core types
export {
  BoundingBox,
  SCHEMA_VERSION,
  IMAGE_TYPES,
  PROCESSING_MODES,
  PLUGIN_TYPES,
  SPATIAL_RELATIONS,
  SEMANTIC_RELATIONS,
  type ImageType,
  type ProcessingMode,
  type PluginType,
  type SpatialRelation,
  type SemanticRelation,
  type ImageInput,
  type Entity,
  type SceneGraph,
  type SpatialRelationEdge,
  type SemanticRelationEdge,
  type ReasonerOutput,
  type ActionHint,
  type PluginResult,
  type VisionResponse,
  type ClassificationResult,
  type ModeSelection,
  type RequestContext,
} from './core/types.js';

// Errors
export {
  VisionSkillsError,
  ValidationError,
  ProviderError,
  AllProvidersFailedError,
  RateLimitError,
  AuthenticationError,
  ConfigurationError,
} from './core/errors.js';

// Plugin base (for building custom providers)
export { BasePlugin, type VisionPlugin } from './plugins/base.js';
export { type VLMClient } from './scene-graph/semantic.js';

// Built-in providers (for custom registration / advanced use)
// Free tier (Gemini):
export { GeminiOCRPlugin } from './plugins/ocr/gemini.js';
export { GeminiDetectionPlugin } from './plugins/detection/gemini.js';
export { GeminiVLMClient } from './plugins/vlm/gemini.js';
export { GeminiKeyPool } from './plugins/gemini/key-pool.js';
// Paid alternatives:
export { GoogleVisionOCRPlugin } from './plugins/ocr/google-vision.js';
export { GoogleVisionDetectionPlugin } from './plugins/detection/google-vision.js';
export { ClaudeVLMClient } from './plugins/vlm/claude.js';
// Local (free):
export { RuleBasedUIPlugin } from './plugins/ui/rulebased.js';
export { MockOCRPlugin, MockDetectionPlugin, MockUIPlugin } from './plugins/mock.js';

// Cache (for custom backends)
export {
  CacheManager,
  InMemoryCacheBackend,
  type CacheBackend,
} from './cache/cache.js';
