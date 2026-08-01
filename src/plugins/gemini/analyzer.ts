/**
 * Combined Gemini analyzer.
 *
 * Instead of calling Gemini separately for OCR and detection (2 API calls,
 * 2x token cost, 2x rate-limit hits), this makes ONE call that returns both
 * text blocks and objects. The result is memoized per request context so the
 * OCR plugin and detection plugin share a single Gemini call.
 *
 * Memoization key: the RequestContext object identity (each analyze() call
 * builds a fresh context) + image hash fallback.
 */

import type { RequestContext } from '../../core/types.js';
import { z } from 'zod';
import { callGemini, geminiBoxToPixels, stripFences } from './client.js';
import type { GeminiKeyPool } from './key-pool.js';

import type { ImageType } from '../../core/types.js';

export interface ExtractedTable {
  title: string | null;
  columns: string[];
  rows: string[][];
  box_2d?: number[];
}

export interface TextBlockDetail {
  text: string;
  bbox: number[];
  confidence: number;
  language: string | null;
  /** Tier 4: rich text attributes (best-effort, VLM-estimated). */
  color?: string | null;
  emphasis?: string | null; // e.g. "bold", "heading", "error", "muted"
}

export interface CodeInfo {
  language: string | null;
  functions: string[];
  errors: string[];
  snippet: string | null;
}

export interface ExtractedRegion {
  id: string;
  name: string;
  purpose: string;
  box_2d?: number[];
  children?: ExtractedRegion[];
}

export interface ExtractedLayout {
  composition?: {
    ruleOfThirds?: boolean;
    mainSubject?: string | null;
    cameraAngle?: string | null;
    visualHierarchy?: string | null;
  };
  lighting?: {
    source?: string | null;
    direction?: string | null;
    temperature?: string | null;
    brightness?: number | null;
    contrast?: number | null;
    shadowType?: string | null;
  };
  color?: {
    palette?: string[];
    dominant?: string | null;
    saturation?: number | null;
    brightness?: number | null;
    tone?: string | null;
  };
}

export interface CombinedResult {
  imageType: ImageType | null;
  textBlocks: TextBlockDetail[];
  objects: Array<{ label: string; bbox: number[]; confidence: number }>;
  tables: ExtractedTable[];
  /** Tier 6: code understanding when the image shows code. */
  code: CodeInfo | null;
  /** Region tree — the image split into meaningful regions (vision spec §5). */
  regions: ExtractedRegion[];
  /** Layout / lighting / color analysis (vision spec §9–10). */
  layout: ExtractedLayout | null;
  /** Validation issues for fields/items that were discarded while preserving valid data. */
  warnings: string[];
}

/**
 * Deep analysis prompt. Unlike a naive "extract text" call, this instructs the
 * model to be EXHAUSTIVE, to read small text, to keep number/unit pairs
 * together, and to extract tables as structured rows/columns. This is what
 * makes the output meaningfully deeper than a single generic model call.
 */
const PROMPT = `You are a meticulous image analysis engine. Analyze this image THOROUGHLY and return structured data. Do not summarize or skip anything — be exhaustive.

Return ONLY a JSON object (no markdown) with this exact shape:
{
  "image_type": "real_world | screen_ui | document | mixed",
  "text_blocks": [{"text": "...", "box_2d": [ymin, xmin, ymax, xmax], "language": "vi", "color": "#ff3333", "emphasis": "error"}],
  "objects": [{"label": "person", "box_2d": [ymin, xmin, ymax, xmax], "confidence": 0.95}],
  "tables": [{"title": "...", "columns": ["col1","col2"], "rows": [["a","b"],["c","d"]], "box_2d": [ymin, xmin, ymax, xmax]}],
  "code": {"language": "python", "functions": ["render_video"], "errors": ["TypeError: ..."], "snippet": "def render_video(): ..."},
  "regions": [{"id": "region_1", "name": "top_bar", "purpose": "navigation", "box_2d": [ymin, xmin, ymax, xmax], "children": []}],
  "layout": {
    "composition": {"rule_of_thirds": true, "main_subject": "login form", "camera_angle": "eye_level", "visual_hierarchy": "form center, header top"},
    "lighting": {"source": "artificial", "direction": "top-left", "temperature": "cool", "brightness": 0.7, "contrast": 0.6, "shadow_type": "soft"},
    "color": {"palette": ["#ffffff","#4a90d9","#333333"], "dominant": "light", "saturation": 0.4, "brightness": 0.8, "tone": "clean"}
  }
}

CRITICAL rules for thoroughness:
- Read EVERY piece of text, including small labels, numbers, units, icons with
  text, menu items, buttons, status indicators, timestamps. Do not stop early.
- Keep numbers together with their units/labels in one block when they belong
  together (e.g. "~$2203.68", "456.238.541 tokens", "17s ago").
- Preserve original language and diacritics exactly (e.g. Vietnamese: "Theo dõi").
- For each text block, when visually clear, add "color" (hex) and "emphasis"
  (one of: "heading", "bold", "error", "warning", "success", "muted", "link",
  or omit if normal). Best-effort; omit if unsure.
- If the image contains any TABLE or list of rows (dashboards, invoices,
  logs, spreadsheets), extract it into "tables" as columns + rows. Still also
  include the individual cells in text_blocks.
- If the image shows source code, a terminal, or an IDE, fill "code" with the
  detected language, visible function/class names, any error/stack-trace text,
  and a short representative snippet. Otherwise set "code" to null.
- REGIONS: split the image into its main functional regions (top_bar, sidebar,
  main_content, footer, nav, header, form_area, etc). Each region has a purpose
  ("navigation", "content", "input", "footer"...). Nest children when regions
  contain sub-regions. Empty array if the image has no clear regions.
- LAYOUT: best-effort composition (rule_of_thirds for real photos, main_subject,
  camera_angle, visual_hierarchy), lighting (source, direction, temperature,
  brightness 0-1, contrast 0-1, shadow_type), color (3-6 hex palette, dominant
  tone, saturation 0-1, brightness 0-1). Omit/use null when uncertain.
- image_type: "screen_ui" for app/website/software; "document" for
  scanned/photographed paper; "real_world" for photos; "mixed" if unclear.
- box_2d values are integers 0-1000 normalized to image dimensions.
- Use concise lowercase object labels.
- Empty arrays are allowed. NEVER omit a field.`;

const VALID_TYPES: ReadonlySet<string> = new Set([
  'real_world',
  'screen_ui',
  'document',
  'mixed',
]);

const boxSchema = z.array(z.number().finite()).length(4);
const nullableString = z.string().nullable().optional();
const unitNumber = z.number().finite().min(0).max(1).nullable().optional();
type RawRegion = {
  id?: string;
  name: string;
  purpose?: string;
  box_2d?: number[];
  children?: RawRegion[];
};
const regionSchema: z.ZodType<RawRegion> = z.lazy(() => z.object({
  id: z.string().optional(),
  name: z.string(),
  purpose: z.string().optional(),
  box_2d: boxSchema.optional(),
  children: z.array(regionSchema).optional(),
}).passthrough());
const layoutSchema = z.object({
  composition: z.object({
    rule_of_thirds: z.boolean().optional(), main_subject: nullableString,
    camera_angle: nullableString, visual_hierarchy: nullableString,
  }).passthrough().optional(),
  lighting: z.object({
    source: nullableString, direction: nullableString, temperature: nullableString,
    brightness: unitNumber, contrast: unitNumber, shadow_type: nullableString,
  }).passthrough().optional(),
  color: z.object({
    palette: z.array(z.string()).optional(), dominant: nullableString,
    saturation: unitNumber, brightness: unitNumber, tone: nullableString,
  }).passthrough().optional(),
}).passthrough();
const textBlockSchema = z.object({
  text: z.string(), box_2d: boxSchema, language: z.string().nullable().optional(),
  color: z.string().nullable().optional(), emphasis: z.string().nullable().optional(),
}).passthrough();
const objectSchema = z.object({
  label: z.string(), box_2d: boxSchema, confidence: z.number().finite().optional(),
}).passthrough();
const tableSchema = z.object({
  title: z.string().nullable().optional(), columns: z.array(z.string()),
  rows: z.array(z.array(z.string())), box_2d: boxSchema.optional(),
}).passthrough();
const codeSchema = z.object({
  language: z.string().nullable(), functions: z.array(z.string()),
  errors: z.array(z.string()), snippet: z.string().nullable(),
}).passthrough();
const combinedSchema = z.object({
  image_type: z.unknown().optional(), text_blocks: z.unknown().optional(),
  objects: z.unknown().optional(), tables: z.unknown().optional(),
  code: z.unknown().optional(), regions: z.unknown().optional(), layout: z.unknown().optional(),
}).passthrough();

function clampConfidence(value: number, fallback: number): number {
  const number = Number.isFinite(value) ? value : fallback;
  return Math.min(1, Math.max(0, number));
}

// Per-context memoization: WeakMap keyed by the context object so entries are
// garbage-collected automatically when the request finishes.
const cache = new WeakMap<RequestContext, Promise<CombinedResult>>();

export interface AnalyzeOptions {
  /** 'deep' also tiles large images for thorough reading. Default 'fast'. */
  depth?: 'fast' | 'deep';
}

export async function analyzeCombined(
  keyPool: GeminiKeyPool,
  model: string,
  image: Buffer,
  context: RequestContext,
  timeoutMs: number,
  options: AnalyzeOptions = {},
): Promise<CombinedResult> {
  const existing = cache.get(context);
  if (existing) return existing;

  const promise = doAnalyze(keyPool, model, image, context, timeoutMs, options);
  cache.set(context, promise);
  return promise;
}

async function doAnalyze(
  keyPool: GeminiKeyPool,
  model: string,
  image: Buffer,
  context: RequestContext,
  timeoutMs: number,
  options: AnalyzeOptions,
): Promise<CombinedResult> {
  const raw = await callGemini({
    keyPool,
    model,
    prompt: PROMPT,
    imageBase64: image.toString('base64'),
    timeoutMs,
    jsonOutput: true,
    context,
  });
  const base = parseCombined(raw, context.imageWidth, context.imageHeight);

  // Deep mode: also tile large/dense images and merge, for thorough, stable
  // reading of small text. Lazy-imported to avoid a cycle.
  if (options.depth === 'deep') {
    const { analyzeMultiRegion } = await import('./multi-region.js');
    return analyzeMultiRegion(keyPool, model, image, context, timeoutMs, base);
  }

  return base;
}

export function parseCombined(raw: string, width: number, height: number): CombinedResult {
  let data: z.infer<typeof combinedSchema>;
  const warnings: string[] = [];
  try {
    data = combinedSchema.parse(JSON.parse(stripFences(raw)));
  } catch {
    return {
      imageType: null,
      textBlocks: [],
      objects: [],
      tables: [],
      code: null,
      regions: [],
      layout: null,
      warnings: ['Gemini combined response was not valid JSON'],
    };
  }

  const rawType = typeof data.image_type === 'string' ? data.image_type : undefined;
  const imageType =
    rawType && VALID_TYPES.has(rawType) ? (rawType as ImageType) : null;

  const safeItems = <T>(field: string, value: unknown, schema: z.ZodType<T>): T[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      warnings.push(`Gemini ${field} was not an array and was ignored`);
      return [];
    }
    return value.flatMap((item, index) => {
      const parsed = schema.safeParse(item);
      if (parsed.success) return [parsed.data];
      warnings.push(`Gemini ${field}[${index}] was malformed and was ignored`);
      return [];
    });
  };
  const rawTexts = safeItems('text_blocks', data.text_blocks, textBlockSchema);
  const rawObjects = safeItems('objects', data.objects, objectSchema);
  const rawTables = safeItems('tables', data.tables, tableSchema);

  const textBlocks = rawTexts
    .map((d) => ({
      text: String(d.text ?? ''),
      bbox: geminiBoxToPixels((d.box_2d as number[]) ?? [], width, height),
      confidence: 0.9,
      language: (d.language as string) ?? null,
      color: (d.color as string) ?? null,
      emphasis: (d.emphasis as string) ?? null,
    }))
    .filter((b) => b.text.trim().length > 0);

  const objects = rawObjects
    .map((d) => ({
      label: String(d.label ?? 'object'),
      bbox: geminiBoxToPixels((d.box_2d as number[]) ?? [], width, height),
      confidence: clampConfidence(d.confidence ?? 0.85, 0.85),
    }))
    .filter((o) => o.label.trim().length > 0);

  const tables = rawTables
    .map((d) => ({
      title: (d.title as string) ?? null,
      columns: d.columns,
      rows: d.rows,
      box_2d: Array.isArray(d.box_2d)
        ? geminiBoxToPixels(d.box_2d as number[], width, height)
        : undefined,
    }))
    .filter((t) => t.columns.length > 0 || t.rows.length > 0);

  const parsedCode = codeSchema.safeParse(data.code);
  const rawCode = parsedCode.success ? parsedCode.data : null;
  if (data.code !== undefined && data.code !== null && !parsedCode.success) {
    warnings.push('Gemini code was malformed and was ignored');
  }
  let code: CodeInfo | null = null;
  if (rawCode && typeof rawCode === 'object') {
    const c = rawCode as Record<string, unknown>;
    const functions = Array.isArray(c.functions) ? c.functions.map((f) => String(f)) : [];
    const errors = Array.isArray(c.errors) ? c.errors.map((e) => String(e)) : [];
    const language = (c.language as string) ?? null;
    const snippet = (c.snippet as string) ?? null;
    // Only keep if there's actually something useful.
    if (language || functions.length > 0 || errors.length > 0 || snippet) {
      code = { language, functions, errors, snippet };
    }
  }

  // Regions: parse with optional nested children.
  const rawRegions = safeItems('regions', data.regions, regionSchema);
  const parseRegion = (d: RawRegion): ExtractedRegion | null => {
    const name = String(d.name ?? '').trim();
    if (!name) return null;
    return {
      id: String(d.id ?? name),
      name,
      purpose: String(d.purpose ?? ''),
      box_2d: Array.isArray(d.box_2d)
        ? geminiBoxToPixels(d.box_2d as number[], width, height)
        : undefined,
      children: Array.isArray(d.children)
        ? d.children
            .map((c) => parseRegion(c))
            .filter((r): r is ExtractedRegion => r !== null)
        : undefined,
    };
  };
  const regions = rawRegions
    .map((r) => parseRegion(r))
    .filter((r): r is ExtractedRegion => r !== null);

  // Layout / lighting / color (best-effort).
  let layout: ExtractedLayout | null = null;
  const parsedLayout = layoutSchema.safeParse(data.layout);
  const rawLayout = parsedLayout.success ? parsedLayout.data : null;
  if (data.layout !== undefined && data.layout !== null && !parsedLayout.success) {
    warnings.push('Gemini layout was malformed and was ignored');
  }
  if (rawLayout && typeof rawLayout === 'object') {
    const l = rawLayout as Record<string, unknown>;
    const composition =
      l.composition && typeof l.composition === 'object'
        ? (l.composition as Record<string, unknown>)
        : undefined;
    const lighting =
      l.lighting && typeof l.lighting === 'object'
        ? (l.lighting as Record<string, unknown>)
        : undefined;
    const color =
      l.color && typeof l.color === 'object'
        ? (l.color as Record<string, unknown>)
        : undefined;

    if (composition || lighting || color) {
      layout = {
        composition: composition
          ? {
              ruleOfThirds: composition.rule_of_thirds === true,
              mainSubject: (composition.main_subject as string) ?? null,
              cameraAngle: (composition.camera_angle as string) ?? null,
              visualHierarchy: (composition.visual_hierarchy as string) ?? null,
            }
          : undefined,
        lighting: lighting
          ? {
              source: (lighting.source as string) ?? null,
              direction: (lighting.direction as string) ?? null,
              temperature: (lighting.temperature as string) ?? null,
              brightness: typeof lighting.brightness === 'number' ? lighting.brightness : null,
              contrast: typeof lighting.contrast === 'number' ? lighting.contrast : null,
              shadowType: (lighting.shadow_type as string) ?? null,
            }
          : undefined,
        color: color
          ? {
              palette: Array.isArray(color.palette)
                ? color.palette.map((p) => String(p)).slice(0, 6)
                : undefined,
              dominant: (color.dominant as string) ?? null,
              saturation: typeof color.saturation === 'number' ? color.saturation : null,
              brightness: typeof color.brightness === 'number' ? color.brightness : null,
              tone: (color.tone as string) ?? null,
            }
          : undefined,
      };
    }
  }

  return { imageType, textBlocks, objects, tables, code, regions, layout, warnings };
}

/**
 * Read the Gemini-classified image type from the memoized combined result,
 * if available. Returns null if the analyzer was never called (e.g. no
 * Gemini provider) or classification was missing.
 */
export async function getGeminiImageType(
  context: RequestContext,
): Promise<ImageType | null> {
  const existing = cache.get(context);
  if (!existing) return null;
  try {
    return (await existing).imageType;
  } catch {
    return null;
  }
}

/** Read the extracted tables from the memoized combined result (or []). */
export async function getGeminiTables(
  context: RequestContext,
): Promise<ExtractedTable[]> {
  const existing = cache.get(context);
  if (!existing) return [];
  try {
    return (await existing).tables;
  } catch {
    return [];
  }
}

/** Read the detected code info from the memoized combined result (or null). */
export async function getGeminiCode(context: RequestContext): Promise<CodeInfo | null> {
  const existing = cache.get(context);
  if (!existing) return null;
  try {
    return (await existing).code;
  } catch {
    return null;
  }
}

/** Read the extracted regions from the memoized combined result (or []). */
export async function getGeminiRegions(
  context: RequestContext,
): Promise<ExtractedRegion[]> {
  const existing = cache.get(context);
  if (!existing) return [];
  try {
    return (await existing).regions;
  } catch {
    return [];
  }
}

/** Read the layout/lighting/color analysis (or null). */
export async function getGeminiLayout(
  context: RequestContext,
): Promise<ExtractedLayout | null> {
  const existing = cache.get(context);
  if (!existing) return null;
  try {
    return (await existing).layout;
  } catch {
    return null;
  }
}
