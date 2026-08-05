/**
 * VisionSkills - main SDK entry point.
 *
 * Wires together classifier, router, orchestrator, normalizer, scene graph,
 * reasoner, cache, and providers into a single analyze() method.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { resolveConfig, type ResolvedConfig, type VisionSkillsConfig } from './config.js';
import { CacheManager } from './cache/cache.js';
import { ConfigurationError, ValidationError } from './core/errors.js';
import { ImageClassifier } from './core/classifier.js';
import { ProviderOrchestrator } from './core/orchestrator.js';
import { ModeRouter } from './core/router.js';
import {
  SCHEMA_VERSION,
  BoundingBox,
  REQUESTED_MODES,
  type ImageInput,
  type GeminiTelemetry,
  type KnowledgeGraph,
  type RequestedMode,
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
import { RuleBasedUIPlugin } from './plugins/ui/rulebased.js';
import { MockOCRPlugin, MockDetectionPlugin, MockUIPlugin } from './plugins/mock.js';

export interface AnalyzeOptions {
  mode?: RequestedMode;
  enableReasoner?: boolean;
  clientApiKey?: string;
  budgetRemaining?: number;
  signal?: AbortSignal;
  reportProgress?: (progress: number, message?: string) => void | Promise<void>;
  analysisDepth?: 'fast' | 'deep';
}

const analyzeOptionsSchema = z.object({
  mode: z.enum(REQUESTED_MODES).optional(),
  enableReasoner: z.boolean().optional(),
  clientApiKey: z.string().min(1).optional(),
  budgetRemaining: z.number().min(0).finite().optional(),
  signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
  reportProgress: z.custom<NonNullable<AnalyzeOptions['reportProgress']>>(
    (value) => typeof value === 'function',
  ).optional(),
  analysisDepth: z.enum(['fast', 'deep']).optional(),
}).strict();

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
      this.config.maxImagePixels,
      this.config.imageFetchTimeoutMs,
    );
    this.classifier = new ImageClassifier(this.config.classifierFinalThreshold);
    this.router = new ModeRouter(this.config.classifierFinalThreshold);
    this.orchestrator = new ProviderOrchestrator();
    this.normalizer = new Normalizer();
    this.cache = new CacheManager(
      this.config.cacheBackend,
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
    const parsedOptions = analyzeOptionsSchema.safeParse(options);
    if (!parsedOptions.success) {
      throw new ValidationError(
        `Invalid analyze options: ${parsedOptions.error.issues.map((i) => i.message).join('; ')}`,
        parsedOptions.error.issues,
      );
    }
    options = parsedOptions.data;
    const start = performance.now();
    const requestId = randomUUID();

    // 1. Load + preprocess
    options.signal?.throwIfAborted();
    await options.reportProgress?.(5, 'Loading image');
    const raw = await this.image.load(source, options.signal);
    const { buffer, width, height } = await this.image.preprocess(raw, options.signal);
    const imageHash = this.image.computeHash(buffer);

    // 2. Classify
    const classification = await this.classifier.classify(buffer);

    // 3. Route
    const requestedMode = options.mode ?? this.config.defaultMode;
    const selection = this.router.select(
      classification,
      requestedMode,
      options.budgetRemaining,
    );
    const mode = selection.modeSelected;
    const policy = ModeRouter.policyFor(mode);
    const enableReasoner = policy.reasoner && (options.enableReasoner ?? this.config.enableReasoner);
    const enableSemantic = policy.semantic && this.config.enableSemanticRelationships;

    // 3b. Cache lookup
    const cacheKey = CacheManager.makeKey(imageHash, mode, {
      schemaVersion: SCHEMA_VERSION,
      analysisDepth: options.analysisDepth ?? this.config.analysisDepth,
      enableReasoner,
      enableSemanticRelationships: enableSemantic,
      geminiModel: this.config.geminiModel,
    });
    const cached = await this.cache.get<VisionResponse>(cacheKey);
    if (cached) return this.hydrateCachedResponse(cached, requestId);

    // 4. Context
    const context: RequestContext = {
      requestId,
      imageWidth: width,
      imageHeight: height,
      mode,
      imageType: classification.type,
      clientApiKey: options.clientApiKey,
      enableReasoner,
      analysisDepth: options.analysisDepth ?? this.config.analysisDepth,
      signal: options.signal,
      reportProgress: options.reportProgress,
      metadata: {
        geminiTelemetry: { calls: 0, attempts: 0, successes: 0, failures: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      },
    };

    // 5. Run providers
    const pluginTypes = ModeRouter.pluginTypesFor(mode);
    await options.reportProgress?.(25, 'Running vision providers');
    const pluginResults = await this.orchestrator.run(buffer, context, pluginTypes);
    options.signal?.throwIfAborted();

    // 6. Normalize
    const entities = this.normalizer.normalize(pluginResults);

    // 6b. Refine image type with Gemini's classification (more accurate than
    // the heuristic). If Gemini ran (it was memoized during provider calls),
    // prefer its answer for downstream semantic taxonomy + output.
    const geminiType = await getGeminiImageType(context);
    const effectiveType = geminiType ?? classification.type;

    // Structured tables extracted by the deep analyzer (if any).
    const rawTables = policy.combinedStructuredFields ? await getGeminiTables(context) : [];
    const tables: Table[] = rawTables.map((t) => ({
      title: t.title,
      columns: t.columns,
      rows: t.rows,
      bbox: t.box_2d ? BoundingBox.fromList(t.box_2d) : undefined,
    }));

    // Detected code / terminal content (tier 6), if any.
    const code = policy.combinedStructuredFields ? await getGeminiCode(context) : null;
    // Region tree + layout/lighting/color (vision spec §5, §9–10).
    const rawRegions = policy.combinedStructuredFields ? await getGeminiRegions(context) : [];
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
    const layout = policy.combinedStructuredFields ? await getGeminiLayout(context) : null;

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
      const semanticPromise = enableSemantic
        ? new SemanticGraphBuilder(this.vlm).build(buffer, entities, effectiveType, context)
        : Promise.resolve([] as SceneGraph['semantic']);

      const reasonerPromise = enableReasoner
        ? new Reasoner(this.vlm).reason({
            image: buffer,
            entities,
            sceneGraph: { spatial: spatialEdges, semantic: [] },
            imageType: effectiveType,
            tables,
            code,
            context,
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
      edges: [...sceneGraph.spatial, ...sceneGraph.semantic].map((edge) => ({
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
      confidence: this.requestConfidence(classification.confidence, [
        ...pluginResults.map((r) => r.confidence),
      ]),
      provenance: {
        requestId,
        requestedMode,
        modeSelectionReason: selection.reason,
        classifier: classification.classifierLayerUsed,
        providers: [...new Set(pluginResults.map((r) => r.provider))],
        cacheHit: false,
      },
      telemetry: {
        gemini: context.metadata.geminiTelemetry as GeminiTelemetry,
      },
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
    if (!this.config.useMockProviders && this.geminiKeyPool.hasKeys) {
      return new GeminiVLMClient(this.geminiKeyPool, this.config.geminiModel);
    }
    return null;
  }

  private requestConfidence(classifier: number, providers: number[]): number {
    const valid = [classifier, ...providers].filter(Number.isFinite).map((n) => Math.min(1, Math.max(0, n)));
    return Math.round((valid.reduce((sum, n) => sum + n, 0) / valid.length) * 1000) / 1000;
  }

  private hydrateCachedResponse(response: VisionResponse, requestId: string): VisionResponse {
    const box = (value: BoundingBox): BoundingBox => BoundingBox.fromList([
      value.x1, value.y1, value.x2, value.y2,
    ]);
    response.entities.forEach((entity) => { entity.bbox = box(entity.bbox); });
    const hydrateRegions = (regions: Region[]): void => regions.forEach((region) => {
      if (region.bbox) region.bbox = box(region.bbox);
      if (region.children) hydrateRegions(region.children);
    });
    hydrateRegions(response.regions);
    response.tables.forEach((table) => { if (table.bbox) table.bbox = box(table.bbox); });
    const originRequestId = response.provenance.cacheOrigin?.requestId ?? response.provenance.requestId;
    const originLatency = response.provenance.cacheOrigin?.latencyMsTotal ?? response.latencyMsTotal;
    const originCost = response.provenance.cacheOrigin?.costActualTotal ?? response.costActualTotal;
    const originProviders = response.provenance.cacheOrigin?.providers ?? response.provenance.providers;
    response.provenance = {
      ...response.provenance,
      requestId,
      cacheHit: true,
      providers: [],
      cacheOrigin: {
        requestId: originRequestId,
        latencyMsTotal: originLatency,
        costActualTotal: originCost,
        providers: originProviders,
      },
    };
    response.providerResults = [];
    response.costActualTotal = 0;
    response.latencyMsTotal = 0;
    response.telemetry = { gemini: { calls: 0, attempts: 0, successes: 0, failures: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
    return response;
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

    // Local UI detection is always available (free).
    this.orchestrator.register(new RuleBasedUIPlugin());

    // Explicit mock mode is the only no-key path. In normal operation, fail
    // fast instead of silently returning fake OCR/detection results.
    if (this.orchestrator.getPlugins('ocr').length === 0) {
      throw new ConfigurationError(
        'No Gemini API key configured. Provide geminiApiKey/geminiApiKeys, GEMINI_API_KEY/GEMINI_API_KEYS, or set useMockProviders: true for tests.',
      );
    }
  }
}
