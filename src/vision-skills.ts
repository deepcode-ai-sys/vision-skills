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
  BoundingBox,
  type ImageInput,
  type KnowledgeGraph,
  type ProcessingMode,
  type Region,
  type RequestContext,
  type SceneGraph,
  type Table,
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
import {
  getGeminiImageType,
  getGeminiTables,
  getGeminiCode,
  getGeminiRegions,
  getGeminiLayout,
} from './plugins/gemini/analyzer.js';
import { GeminiKeyPool } from './plugins/gemini/key-pool.js';
import { GoogleVisionOCRPlugin } from './plugins/ocr/google-vision.js';
import { GoogleVisionDetectionPlugin } from './plugins/detection/google-vision.js';
import { RuleBasedUIPlugin } from './plugins/ui/rulebased.js';
import { MockOCRPlugin, MockDetectionPlugin, MockUIPlugin } from './plugins/mock.js';

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
  private geminiKeyPool: GeminiKeyPool;

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
    // Single shared key pool for all Gemini plugins + VLM (rotation on 429).
    this.geminiKeyPool = new GeminiKeyPool(this.config.geminiApiKeys);
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

    // 6b. Refine image type with Gemini's classification (more accurate than
    // the heuristic). If Gemini ran (it was memoized during provider calls),
    // prefer its answer for downstream semantic taxonomy + output.
    const geminiType = await getGeminiImageType(context);
    const effectiveType = geminiType ?? classification.type;

    // Structured tables extracted by the deep analyzer (if any).
    const rawTables = await getGeminiTables(context);
    const tables: Table[] = rawTables.map((t) => ({
      title: t.title,
      columns: t.columns,
      rows: t.rows,
      bbox: t.box_2d ? BoundingBox.fromList(t.box_2d) : undefined,
    }));

    // Detected code / terminal content (tier 6), if any.
    const code = await getGeminiCode(context);

    // Region tree + layout/lighting/color (vision spec §5, §9–10).
    const rawRegions = await getGeminiRegions(context);
    const regions: Region[] = rawRegions.map((r) => ({
      id: r.id,
      name: r.name,
      purpose: r.purpose,
      bbox: r.box_2d ? BoundingBox.fromList(r.box_2d) : undefined,
      children: r.children?.map((c) => ({
        id: c.id,
        name: c.name,
        purpose: c.purpose,
        bbox: c.box_2d ? BoundingBox.fromList(c.box_2d) : undefined,
      })),
    }));
    const layout = await getGeminiLayout(context);

    // 7. Spatial scene graph (all modes)
    const spatialBuilder = new SpatialGraphBuilder(width, height, {
      thresholdX: this.config.spatialThresholdX,
      thresholdY: this.config.spatialThresholdY,
      nearThreshold: this.config.spatialNearThreshold,
      overlapIouThreshold: this.config.spatialOverlapIouThreshold,
    });
    const spatialEdges = spatialBuilder.build(entities);

    // Assign UI/layout hierarchy (parentId) from containment relationships.
    SpatialGraphBuilder.assignHierarchy(entities);

    // 7b. Semantic graph (VLM, Advanced/Full only — most expensive).
    // 8.  Reasoner (VLM, Standard and above — fable-style thinking).
    // They run in PARALLEL to cut latency; the reasoner works from spatial
    // relations + entities and does not strictly need semantic edges first.
    let semanticEdges: SceneGraph['semantic'] = [];
    let reasonerOutput = null;
    if (this.vlm) {
      const wantSemantic =
        VLM_MODES.has(mode) && this.config.enableSemanticRelationships;
      const wantReasoner = enableReasoner;

      const semanticPromise = wantSemantic
        ? new SemanticGraphBuilder(this.vlm).build(buffer, entities, effectiveType)
        : Promise.resolve([] as SceneGraph['semantic']);

      const reasonerPromise = wantReasoner
        ? new Reasoner(this.vlm).reason({
            image: buffer,
            entities,
            sceneGraph: { spatial: spatialEdges, semantic: [] },
            imageType: effectiveType,
            tables,
            code,
          })
        : Promise.resolve(null);

      [semanticEdges, reasonerOutput] = await Promise.all([semanticPromise, reasonerPromise]);
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

    // Knowledge graph: nodes = entities, edges = scene graph relations.
    // Built deterministically in code (no extra API call) — the LLM-friendly
    // form of the same data (vision spec §14).
    const knowledgeGraph: KnowledgeGraph = {
      nodes: entities.map((e) => ({
        id: e.entityId,
        type: e.label,
        text: e.text ?? null,
      })),
      edges: sceneGraph.spatial.map((edge) => ({
        from: edge.subjectId,
        relation: edge.relation,
        to: edge.objectId,
        confidence: edge.confidence,
      })),
    };

    const response: VisionResponse = {
      schemaVersion: SCHEMA_VERSION,
      imageType: effectiveType,
      modeUsed: mode,
      entities,
      regions,
      layout,
      knowledgeGraph,
      tables,
      code,
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
    if (this.geminiKeyPool.hasKeys) {
      return new GeminiVLMClient(this.geminiKeyPool, this.config.geminiModel);
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
    // Both plugins share ONE key pool so rate-limited keys are skipped
    // consistently across OCR and detection.
    if (this.geminiKeyPool.hasKeys) {
      const depth = this.config.analysisDepth;
      this.orchestrator.register(
        new GeminiOCRPlugin(this.geminiKeyPool, this.config.geminiModel, depth),
      );
      this.orchestrator.register(
        new GeminiDetectionPlugin(this.geminiKeyPool, this.config.geminiModel, depth),
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
