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
 *   geminiApiKey: process.env.GEMINI_API_KEY,
 * });
 *
 * const result = await vision.analyze('./screenshot.png', { mode: 'standard' });
 * console.log(JSON.stringify(result, null, 2));
 * ```
 */

export { VisionSkills, type AnalyzeOptions } from './vision-skills.js';
export { type VisionSkillsConfig, type ResolvedConfig, resolveConfig } from './config.js';
export { ModeRouter } from './core/router.js';
export { SpecialistRegistry, SpecialistRouter } from './specialists/router.js';
export { SpecialistOrchestrator } from './specialists/orchestrator.js';
export { HttpSpecialistProvider, redactHeaders, type SpecialistProvider } from './specialists/http.js';
export {
  CanonicalV1Codec,
  PaddleOcrClassicCodec,
  DoclingJsonCodec,
  OmniParserV2Codec,
  OpenAiChatCompletionsCodec,
  createSpecialistCodec,
  type SpecialistCodec,
} from './specialists/codecs.js';
export { composeSpecialists } from './specialists/compose.js';
export {
  characterErrorRate,
  wordErrorRate,
  boxIou,
  boxPrecisionRecallF1,
  labeledBoxPrecisionRecallF1,
  percentile,
  type BoxMetric,
  type LabeledBox,
} from './benchmark/metrics.js';
export {
  SPECIALIST_CAPABILITIES,
  SPECIALIST_PROTOCOLS,
  canonicalV1Schema,
  emptyCanonicalOutput,
  type SpecialistCapability,
  type SpecialistProtocol,
  type SpecialistProviderConfig,
  type SpecialistRouteConfig,
  type SpecialistsConfig,
  type SpecialistCanonicalOutput,
  type SpecialistRouteTrace,
  type SpecialistCallMetric,
  type SpecialistUsage,
  type SpecialistRunResult,
} from './specialists/types.js';

// Core types
export {
  BoundingBox,
  SCHEMA_VERSION,
  IMAGE_TYPES,
  PROCESSING_MODES,
  REQUESTED_MODES,
  PLUGIN_TYPES,
  SPATIAL_RELATIONS,
  SEMANTIC_RELATIONS,
  type ImageType,
  type ProcessingMode,
  type RequestedMode,
  type ModePolicy,
  type PluginType,
  type SpatialRelation,
  type SemanticRelation,
  type ImageInput,
  type Entity,
  type Table,
  type CodeInfo,
  type Region,
  type LayoutInfo,
  type KnowledgeGraph,
  type SceneGraph,
  type SpatialRelationEdge,
  type SemanticRelationEdge,
  type ReasonerOutput,
  type ActionHint,
  type PluginResult,
  type VisionResponse,
  type ResponseProvenance,
  type RequestTelemetry,
  type GeminiTelemetry,
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
// Local (free):
export { RuleBasedUIPlugin } from './plugins/ui/rulebased.js';
export { MockOCRPlugin, MockDetectionPlugin, MockUIPlugin } from './plugins/mock.js';

// Cache (for custom backends)
export {
  CacheManager,
  InMemoryCacheBackend,
  type CacheBackend,
} from './cache/cache.js';
