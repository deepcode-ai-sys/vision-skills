import { z } from 'zod';

import type { CodeInfo, Entity, LayoutInfo, Region, Table } from '../core/types.js';

export const SPECIALIST_CAPABILITIES = [
  'ocr', 'objects', 'ui', 'tables', 'regions', 'layout', 'code',
] as const;
export type SpecialistCapability = (typeof SPECIALIST_CAPABILITIES)[number];

export const SPECIALIST_PROTOCOLS = [
  'canonical-v1',
  'paddleocr-classic',
  'docling-json',
  'omniparser-v2',
  'openai-chat-completions',
] as const;
export type SpecialistProtocol = (typeof SPECIALIST_PROTOCOLS)[number];

export interface CanonicalBox {
  /** Pixel coordinates [x1, y1, x2, y2] in the processed image. */
  bbox: [number, number, number, number];
  confidence: number | null;
}

export interface CanonicalText extends CanonicalBox {
  text: string;
  language?: string | null;
}

export interface CanonicalObject extends CanonicalBox {
  label: string;
}

export interface CanonicalUiElement extends CanonicalBox {
  label: string;
  text?: string | null;
  elementType?: string | null;
  clickable?: boolean | null;
}

export interface CanonicalTable {
  title: string | null;
  columns: string[];
  rows: string[][];
  bbox?: [number, number, number, number];
}

export interface CanonicalRegion {
  id: string;
  name: string;
  purpose: string;
  bbox?: [number, number, number, number];
  children?: CanonicalRegion[];
}

export interface SpecialistCanonicalOutput {
  protocol: 'canonical-v1';
  text: CanonicalText[];
  objects: CanonicalObject[];
  ui: CanonicalUiElement[];
  tables: CanonicalTable[];
  regions: CanonicalRegion[];
  layout: LayoutInfo | null;
  code: CodeInfo | null;
}

export interface SpecialistProviderConfig {
  id: string;
  protocol: SpecialistProtocol;
  endpoint: string;
  capabilities: SpecialistCapability[];
  model?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface SpecialistRouteConfig {
  providers: string[];
  mode: 'augment' | 'replace';
}

export interface SpecialistsConfig {
  providers: SpecialistProviderConfig[];
  routes: Partial<Record<SpecialistCapability, SpecialistRouteConfig>>;
}

export interface SpecialistCallMetric {
  provider: string;
  capabilities: SpecialistCapability[];
  latencyMs: number;
  ok: boolean;
  error?: string;
}

export interface SpecialistRouteTrace {
  capability: SpecialistCapability;
  mode: 'augment' | 'replace';
  configuredChain: string[];
  attempts: string[];
  selectedProvider: string | null;
  status: 'succeeded' | 'failed';
  error?: string;
}

export interface SpecialistUsage {
  calls: number;
  latencyMs: number;
  byProvider: Record<string, number>;
  callMetrics: SpecialistCallMetric[];
}

export interface SpecialistRunResult {
  outputs: Partial<Record<SpecialistCapability, SpecialistCanonicalOutput>>;
  route: SpecialistRouteTrace[];
  usage: SpecialistUsage;
}

export interface SpecialistComposition {
  entities: Entity[];
  tables: Table[];
  regions: Region[];
  layout: LayoutInfo | null;
  code: CodeInfo | null;
}

const finite = z.number().finite();
const confidenceSchema = z.number().min(0).max(1).finite().nullable();
export const bboxSchema = z.tuple([finite, finite, finite, finite]);
const textSchema = z.object({
  text: z.string(), bbox: bboxSchema, confidence: confidenceSchema,
  language: z.string().nullable().optional(),
}).strict();
const objectSchema = z.object({
  label: z.string().min(1), bbox: bboxSchema, confidence: confidenceSchema,
}).strict();
const uiSchema = z.object({
  label: z.string().min(1), bbox: bboxSchema, confidence: confidenceSchema,
  text: z.string().nullable().optional(),
  elementType: z.string().nullable().optional(),
  clickable: z.boolean().nullable().optional(),
}).strict();
const tableSchema = z.object({
  title: z.string().nullable(), columns: z.array(z.string()), rows: z.array(z.array(z.string())),
  bbox: bboxSchema.optional(),
}).strict();
const regionSchema: z.ZodType<CanonicalRegion> = z.lazy(() => z.object({
  id: z.string(), name: z.string(), purpose: z.string(),
  bbox: bboxSchema.optional(),
  children: z.array(regionSchema).optional(),
}).strict()) as z.ZodType<CanonicalRegion>;

export const canonicalV1Schema: z.ZodType<SpecialistCanonicalOutput> = z.object({
  protocol: z.literal('canonical-v1'),
  text: z.array(textSchema),
  objects: z.array(objectSchema),
  ui: z.array(uiSchema),
  tables: z.array(tableSchema),
  regions: z.array(regionSchema),
  layout: z.object({
    composition: z.object({
      ruleOfThirds: z.boolean().optional(), mainSubject: z.string().nullable().optional(),
      cameraAngle: z.string().nullable().optional(), visualHierarchy: z.string().nullable().optional(),
    }).strict().optional(),
    lighting: z.object({
      source: z.string().nullable().optional(), direction: z.string().nullable().optional(),
      temperature: z.string().nullable().optional(), brightness: finite.nullable().optional(),
      contrast: finite.nullable().optional(), shadowType: z.string().nullable().optional(),
    }).strict().optional(),
    color: z.object({
      palette: z.array(z.string()).optional(), dominant: z.string().nullable().optional(),
      saturation: finite.nullable().optional(), brightness: finite.nullable().optional(),
      tone: z.string().nullable().optional(),
    }).strict().optional(),
  }).strict().nullable(),
  code: z.object({
    language: z.string().nullable(), functions: z.array(z.string()),
    errors: z.array(z.string()), snippet: z.string().nullable(),
  }).strict().nullable(),
}).strict();

export function emptyCanonicalOutput(): SpecialistCanonicalOutput {
  return {
    protocol: 'canonical-v1', text: [], objects: [], ui: [], tables: [],
    regions: [], layout: null, code: null,
  };
}
