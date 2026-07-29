/**
 * Core types, enums, and Zod schemas for Vision Skills.
 *
 * These define the contracts between components (classifier, router,
 * orchestrator, plugins) and the unified output schema (v3.1.0).
 */

// ============================================================================
// Enums (as const unions)
// ============================================================================

export const IMAGE_TYPES = ['real_world', 'screen_ui', 'document', 'mixed'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export const PROCESSING_MODES = ['basic', 'standard', 'advanced', 'full'] as const;
export type ProcessingMode = (typeof PROCESSING_MODES)[number];

export const PLUGIN_TYPES = [
  'ocr',
  'detection',
  'segmentation',
  'layout',
  'face',
  'pose',
  'depth',
  'vlm',
  'ui',
  'custom',
] as const;
export type PluginType = (typeof PLUGIN_TYPES)[number];

export const SPATIAL_RELATIONS = [
  'left_of',
  'right_of',
  'above',
  'below',
  'near',
  'overlapping',
  'contains',
] as const;
export type SpatialRelation = (typeof SPATIAL_RELATIONS)[number];

// Real-world semantic relations (people, objects, scenes)
export const SEMANTIC_RELATIONS = [
  'holding',
  'using',
  'wearing',
  'sitting_on',
  'standing_on',
  'touching',
  'looking_at',
  'next_to',
] as const;
export type SemanticRelation = (typeof SEMANTIC_RELATIONS)[number];

// UI/document semantic relations (screens, apps, forms)
export const UI_RELATIONS = [
  'contains',
  'part_of',
  'labels',
  'controls',
  'belongs_to',
  'submits',
  'opens',
  'toggles',
] as const;
export type UiRelation = (typeof UI_RELATIONS)[number];

/**
 * Allowed semantic relations depend on image type:
 * - real_world -> physical relations (holding, wearing...)
 * - screen_ui / document -> UI relations (contains, labels, controls...)
 * - mixed -> both are allowed
 */
export function allowedSemanticRelations(imageType: ImageType): ReadonlySet<string> {
  if (imageType === 'real_world') {
    return new Set(SEMANTIC_RELATIONS);
  }
  if (imageType === 'screen_ui' || imageType === 'document') {
    return new Set(UI_RELATIONS);
  }
  // mixed: allow both
  return new Set([...SEMANTIC_RELATIONS, ...UI_RELATIONS]);
}

export const ALLOWED_SEMANTIC_RELATIONS: ReadonlySet<string> = new Set(SEMANTIC_RELATIONS);

// ============================================================================
// Geometry
// ============================================================================

/** Bounding box in [x1, y1, x2, y2] pixel coordinates (normalized format). */
export class BoundingBox {
  constructor(
    public x1: number,
    public y1: number,
    public x2: number,
    public y2: number,
  ) {}

  get width(): number {
    return this.x2 - this.x1;
  }
  get height(): number {
    return this.y2 - this.y1;
  }
  get centerX(): number {
    return (this.x1 + this.x2) / 2;
  }
  get centerY(): number {
    return (this.y1 + this.y2) / 2;
  }
  get area(): number {
    return Math.max(0, this.width) * Math.max(0, this.height);
  }

  toList(): [number, number, number, number] {
    return [this.x1, this.y1, this.x2, this.y2];
  }

  static fromXYWH(x: number, y: number, w: number, h: number): BoundingBox {
    return new BoundingBox(x, y, x + w, y + h);
  }

  static fromList(coords: number[]): BoundingBox {
    return new BoundingBox(coords[0] ?? 0, coords[1] ?? 0, coords[2] ?? 0, coords[3] ?? 0);
  }

  /** Intersection-over-Union with another box. */
  iou(other: BoundingBox): number {
    const ix1 = Math.max(this.x1, other.x1);
    const iy1 = Math.max(this.y1, other.y1);
    const ix2 = Math.min(this.x2, other.x2);
    const iy2 = Math.min(this.y2, other.y2);
    const iw = Math.max(0, ix2 - ix1);
    const ih = Math.max(0, iy2 - iy1);
    const inter = iw * ih;
    const union = this.area + other.area - inter;
    return union > 0 ? inter / union : 0;
  }
}

// ============================================================================
// Classification
// ============================================================================

export interface ImageCharacteristics {
  hasUiElements: boolean;
  hasText: boolean;
  isPhoto: boolean;
  aspectRatio: number;
  hasExif: boolean;
}

export interface ClassificationResult {
  type: ImageType;
  confidence: number;
  classifierLayerUsed: string;
  characteristics: ImageCharacteristics;
}

// ============================================================================
// Mode selection
// ============================================================================

export interface ModeSelection {
  modeSelected: ProcessingMode;
  reason: string;
  estimatedCostRange: string;
}

// ============================================================================
// Plugin result
// ============================================================================

export interface PluginResult {
  plugin: string;
  provider: string;
  pluginVersion: string;
  schemaVersion: string;
  confidence: number;
  latencyMs: number;
  costActual: number;
  data: Record<string, unknown>;
  errors: string[];
  warnings: string[];
  piiFlagged: boolean;
}

// ============================================================================
// Entity
// ============================================================================

export interface Entity {
  entityId: string;
  label: string;
  bbox: BoundingBox;
  confidence: number;
  polygon?: number[][];
  text?: string | null;
  visiblePercent?: number | null;
  depth?: number | null;
  colorDominant?: string | null;
  state?: string | null;
  elementType?: string | null;
  enabled?: boolean | null;
  clickable?: boolean | null;
  focused?: boolean | null;
  parentId?: string | null;
  metadata: Record<string, unknown>;
  sourcePlugins: string[];
}

// ============================================================================
// Scene graph
// ============================================================================

export interface SpatialRelationEdge {
  subjectId: string;
  relation: SpatialRelation;
  objectId: string;
  confidence: number;
}

export interface SemanticRelationEdge {
  subjectId: string;
  relation: string;
  objectId: string;
  confidence: number;
}

export interface SceneGraph {
  spatial: SpatialRelationEdge[];
  semantic: SemanticRelationEdge[];
}

// ============================================================================
// Reasoner
// ============================================================================

export interface ActionHint {
  action: string;
  target: string;
  reason: string;
}

export interface ReasonerOutput {
  summary: string;
  uiStateInterpretation?: string | null;
  actionHints: ActionHint[];
  anomalies: string[];
  reasoningConfidence: number;
}

// ============================================================================
// Tables (structured extraction from dashboards, invoices, spreadsheets)
// ============================================================================

export interface Table {
  title: string | null;
  columns: string[];
  rows: string[][];
  bbox?: BoundingBox;
}

/** Detected code / terminal / IDE content (tier 6). */
export interface CodeInfo {
  language: string | null;
  functions: string[];
  errors: string[];
  snippet: string | null;
}

// ============================================================================
// Final response
// ============================================================================

export interface VisionResponse {
  schemaVersion: string;
  imageType: ImageType;
  modeUsed: ProcessingMode;
  entities: Entity[];
  tables: Table[];
  code: CodeInfo | null;
  sceneGraph: SceneGraph;
  reasonerOutput: ReasonerOutput | null;
  providerResults: PluginResult[];
  costActualTotal: number;
  latencyMsTotal: number;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// Request context
// ============================================================================

export interface RequestContext {
  requestId: string;
  imageWidth: number;
  imageHeight: number;
  mode: ProcessingMode;
  imageType: ImageType;
  clientApiKey?: string;
  enableReasoner: boolean;
  metadata: Record<string, unknown>;
}

/** Image input: file path, URL, base64 data URI, or raw bytes. */
export type ImageInput = string | Buffer | Uint8Array;

export const SCHEMA_VERSION = '3.1.0';
