/**
 * VisionSkills - main SDK entry point.
 *
 * Wires together classifier, router, orchestrator, normalizer, scene graph,
 * reasoner, cache, and providers into a single analyze() method.
 */

import { randomUUID } from 'node:crypto';

import { resolveConfig, type ResolvedConfig, type VisionSkillsConfig } from './config.js';
import { CacheManager } from './cache/cache.js';
import { ImageClassifier } from './core/classifier.js';
import { ProviderOrchestrator } from './core/orchestrator.js';
import { ModeRouter } from './core/router.js';
import {
  SCHEMA_VERSION,
  type ImageInput,
  type ProcessingMode,
  type RequestContext,
  type SceneGraph,
  type VisionResponse,
} from './core/types.js';
import { Normalizer } from './normalizers/normalizer.js';
import { Reasoner } from './reasoner/reasoner.js';
import { SemanticGraphBuilder, type VLMClient } from './scene-graph/semantic.js';
import { SpatialGraphBuilder } from './scene-graph/spatial.js';
import { ImageProcessor } from './utils/image.js';
import type { VisionPlugin } from './plugins/base.js';
import { GeminiOCRPlugin } from './plugins/ocr/gemini.js';
import { GeminiDetectionPlugin } from './plugins/detection/gemini.js';
import { GeminiVLMClient } from './plugins/vlm/gemini.js';
import { GoogleVisionOCRPlugin } from './plugins/ocr/google-vision.js';
import { GoogleVisionDetectionPlugin } from './plugins/detection/google-vision.js';
import { RuleBasedUIPlugin } from './plugins/ui/rulebased.js';
import { MockOCRPlugin, MockDetectionPlugin, MockUIPlugin } from './plugins/mock.js';
import { ClaudeVLMClient } from './plugins/vlm/claude.js';

const VLM_MODES: ReadonlySet<ProcessingMode> = new Set(['advanced', 'full']);

export interface AnalyzeOptions {
  mode?: ProcessingMode;
  enableReasoner?: boolean;
  clientApiKey?: string;
  budgetRemaining?: number;
}

export class VisionSkills {
  private config: ResolvedConfig;
  private image: ImageProcessor;
  private classifier: ImageClassifier;
  private router: ModeRouter;
  private orchestrator: ProviderOrchestrator;
  private normalizer: Normalizer;
  private cache: CacheManager;
  private vlm: VLMClient | null;

  constructor(config: VisionSkillsConfig = {}) {
    this.config = resolveConfig(config);
    this.image = new ImageProcessor(
      this.config.maxImageSizeMb,
      this.config.maxDimension,
      this.config.jpegQuality,
    );
    this.classifier = new ImageClassifier(this.config.classifierFinalThreshold);
    this.router = new ModeRouter(this.config.classifierFinalThreshold);
    this.orchestrator = new ProviderOrchestrator();
    this.normalizer = new Normalizer();
    this.cache = new CacheManager(
      undefined,
      this.config.cacheEnabled,
      this.config.cacheTtlSeconds,
    );
    this.vlm = this.buildVlmClient();
    this.registerPlugins();
  }

  /** Register a custom plugin (for extending with new providers). */
  registerPlugin(plugin: VisionPlugin, priority?: number): void {
    this.orchestrator.register(plugin, priority);
  }

  /** Analyze an image and return structured JSON. */
  async analyze(source: ImageInput, options: AnalyzeOptions = {}): Promise<VisionResponse> {
    const start = performance.now();
    const requestId = randomUUID();
    const enableReasoner = options.enableReasoner ?? this.config.enableReasoner;

    // 1. Load + preprocess
    const raw = await this.image.load(source);
    const { buffer, width, height } = await this.image.preprocess(raw);
    const imageHash = this.image.computeHash(buffer);

    // 2. Classify
    const classification = await this.classifier.classify(buffer);

    // 3. Route
    const selection = this.router.select(
      classification,
      options.mode,
      options.budgetRemaining,
    );
    const mode = selection.modeSelected;

    // 3b. Cache lookup
    const cacheKey = CacheManager.makeKey(imageHash, mode, { enableReasoner });
    const cached = await this.cache.get<VisionResponse>(cacheKey);
    if (cached) return cached;

    // 4. Context
    const context: RequestContext = {
      requestId,
      imageWidth: width,
      imageHeight: height,
      mode,
      imageType: classification.type,
      clientApiKey: options.clientApiKey,
      enableReasoner,
      metadata: {},
    };

    // 5. Run providers
    const pluginTypes = ModeRouter.pluginTypesFor(mode);
    const pluginResults = await this.orchestrator.run(buffer, context, pluginTypes);

    // 6. Normalize
    const entities = this.normalizer.normalize(pluginResults);

    // 7. Spatial scene graph (all modes)
    const spatialBuilder = new SpatialGraphBuilder(width, height, {
      thresholdX: this.config.spatialThresholdX,
      thresholdY: this.config.spatialThresholdY,
      nearThreshold: this.config.spatialNearThreshold,
      overlapIouThreshold: this.config.spatialOverlapIouThreshold,
    });
    const spatialEdges = spatialBuilder.build(entities);

    // 7b/8. Semantic + reasoner (VLM, Advanced/Full only)
    let semanticEdges: SceneGraph['semantic'] = [];
    let reasonerOutput = null;
    if (VLM_MODES.has(mode) && this.vlm) {
      if (this.config.enableSemanticRelationships) {
        const semanticBuilder = new SemanticGraphBuilder(this.vlm);
        semanticEdges = await semanticBuilder.build(buffer, entities);
      }
      if (enableReasoner) {
        const reasoner = new Reasoner(this.vlm);
        reasonerOutput = await reasoner.reason(
          buffer,
          entities,
          { spatial: spatialEdges, semantic: semanticEdges },
          classification.type,
        );
      }
    }

    const sceneGraph: SceneGraph = { spatial: spatialEdges, semantic: semanticEdges };

    // 9. Compose
    const costTotal = pluginResults.reduce((s, r) => s + r.costActual, 0);
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const r of pluginResults) {
      r.errors.forEach((e) => errors.push(`[${r.plugin}] ${e}`));
      r.warnings.forEach((w) => warnings.push(`[${r.plugin}] ${w}`));
    }

    const response: VisionResponse = {
      schemaVersion: SCHEMA_VERSION,
      imageType: classification.type,
      modeUsed: mode,
      entities,
      sceneGraph,
      reasonerOutput,
      providerResults: pluginResults,
      costActualTotal: Math.round(costTotal * 1e6) / 1e6,
      latencyMsTotal: Math.round((performance.now() - start) * 100) / 100,
      errors,
      warnings,
    };

    // Cache
    const piiFlagged = pluginResults.some((r) => r.piiFlagged);
    await this.cache.set(cacheKey, response, piiFlagged);

    return response;
  }

  async healthCheck(): Promise<Record<string, boolean>> {
    return this.orchestrator.healthReport();
  }

  cacheStats() {
    return this.cache.stats();
  }

  async clearCache(): Promise<number> {
    return this.cache.clear();
  }

  // ------------------------------------------------------------- internal

  private buildVlmClient(): VLMClient | null {
    // Prefer explicit provider choice; else auto-pick whatever key exists.
    const provider = this.config.vlmProvider;

    if (provider === 'gemini' && this.config.geminiApiKey) {
      return new GeminiVLMClient(this.config.geminiApiKey, this.config.geminiModel);
    }
    if (provider === 'claude' && this.config.anthropicApiKey) {
      const client = new ClaudeVLMClient(this.config.anthropicApiKey, this.config.claudeModel);
      return client.available ? client : null;
    }

    // Auto-fallback: free Gemini first, then Claude.
    if (this.config.geminiApiKey) {
      return new GeminiVLMClient(this.config.geminiApiKey, this.config.geminiModel);
    }
    if (this.config.anthropicApiKey) {
      const client = new ClaudeVLMClient(this.config.anthropicApiKey, this.config.claudeModel);
      return client.available ? client : null;
    }
    return null;
  }

  private registerPlugins(): void {
    if (this.config.useMockProviders) {
      this.orchestrator.register(new MockOCRPlugin());
      this.orchestrator.register(new MockDetectionPlugin());
      this.orchestrator.register(new MockUIPlugin());
      return;
    }

    // FREE tier first: Gemini covers OCR + detection (priority 0).
    if (this.config.geminiApiKey) {
      this.orchestrator.register(new GeminiOCRPlugin(this.config.geminiApiKey, this.config.geminiModel));
      this.orchestrator.register(
        new GeminiDetectionPlugin(this.config.geminiApiKey, this.config.geminiModel),
      );
    }

    // Paid fallbacks: Google Cloud Vision (registered after Gemini).
    if (this.config.googleCloudVisionKey) {
      this.orchestrator.register(new GoogleVisionOCRPlugin(this.config.googleCloudVisionKey));
      this.orchestrator.register(
        new GoogleVisionDetectionPlugin(this.config.googleCloudVisionKey),
      );
    }

    // Local UI detection is always available (free).
    this.orchestrator.register(new RuleBasedUIPlugin());

    // If nothing real registered for OCR, fall back to mock so the SDK still runs.
    if (this.orchestrator.getPlugins('ocr').length === 0) {
      this.orchestrator.register(new MockOCRPlugin());
      this.orchestrator.register(new MockDetectionPlugin());
    }
  }
}
