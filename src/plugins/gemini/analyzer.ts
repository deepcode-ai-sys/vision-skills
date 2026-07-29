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
import { callGemini, geminiBoxToPixels, stripFences } from './client.js';
import type { GeminiKeyPool } from './key-pool.js';

import type { ImageType } from '../../core/types.js';

export interface ExtractedTable {
  title: string | null;
  columns: string[];
  rows: string[][];
  box_2d?: number[];
}

export interface CombinedResult {
  imageType: ImageType | null;
  textBlocks: Array<{ text: string; bbox: number[]; confidence: number; language: string | null }>;
  objects: Array<{ label: string; bbox: number[]; confidence: number }>;
  tables: ExtractedTable[];
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
  "text_blocks": [{"text": "...", "box_2d": [ymin, xmin, ymax, xmax], "language": "vi"}],
  "objects": [{"label": "person", "box_2d": [ymin, xmin, ymax, xmax], "confidence": 0.95}],
  "tables": [{"title": "...", "columns": ["col1","col2"], "rows": [["a","b"],["c","d"]], "box_2d": [ymin, xmin, ymax, xmax]}]
}

CRITICAL rules for thoroughness:
- Read EVERY piece of text, including small labels, numbers, units, icons with
  text, menu items, buttons, status indicators, timestamps. Do not stop early.
- Keep numbers together with their units/labels in one block when they belong
  together (e.g. "~$2203.68", "456.238.541 tokens", "17s ago").
- Preserve original language and diacritics exactly (e.g. Vietnamese: "Theo dõi").
- If the image contains any TABLE or list of rows (dashboards, invoices,
  logs, spreadsheets), extract it into "tables" as columns + rows. Still also
  include the individual cells in text_blocks.
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

// Per-context memoization: WeakMap keyed by the context object so entries are
// garbage-collected automatically when the request finishes.
const cache = new WeakMap<RequestContext, Promise<CombinedResult>>();

export async function analyzeCombined(
  keyPool: GeminiKeyPool,
  model: string,
  image: Buffer,
  context: RequestContext,
  timeoutMs: number,
): Promise<CombinedResult> {
  const existing = cache.get(context);
  if (existing) return existing;

  const promise = doAnalyze(keyPool, model, image, context, timeoutMs);
  cache.set(context, promise);
  return promise;
}

async function doAnalyze(
  keyPool: GeminiKeyPool,
  model: string,
  image: Buffer,
  context: RequestContext,
  timeoutMs: number,
): Promise<CombinedResult> {
  const raw = await callGemini({
    keyPool,
    model,
    prompt: PROMPT,
    imageBase64: image.toString('base64'),
    timeoutMs,
    jsonOutput: true,
  });
  return parseCombined(raw, context.imageWidth, context.imageHeight);
}

export function parseCombined(raw: string, width: number, height: number): CombinedResult {
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(stripFences(raw));
    data = typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return { imageType: null, textBlocks: [], objects: [], tables: [] };
  }

  const rawType = data.image_type as string | undefined;
  const imageType =
    rawType && VALID_TYPES.has(rawType) ? (rawType as ImageType) : null;

  const rawTexts = Array.isArray(data.text_blocks) ? data.text_blocks : [];
  const rawObjects = Array.isArray(data.objects) ? data.objects : [];
  const rawTables = Array.isArray(data.tables) ? data.tables : [];

  const textBlocks = rawTexts
    .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
    .map((d) => ({
      text: String(d.text ?? ''),
      bbox: geminiBoxToPixels((d.box_2d as number[]) ?? [], width, height),
      confidence: 0.9,
      language: (d.language as string) ?? null,
    }))
    .filter((b) => b.text.trim().length > 0);

  const objects = rawObjects
    .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
    .map((d) => ({
      label: String(d.label ?? 'object'),
      bbox: geminiBoxToPixels((d.box_2d as number[]) ?? [], width, height),
      confidence: Number(d.confidence ?? 0.85),
    }))
    .filter((o) => o.label.trim().length > 0);

  const tables = rawTables
    .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
    .map((d) => ({
      title: (d.title as string) ?? null,
      columns: Array.isArray(d.columns) ? d.columns.map((c) => String(c)) : [],
      rows: Array.isArray(d.rows)
        ? d.rows
            .filter((r): r is unknown[] => Array.isArray(r))
            .map((r) => r.map((cell) => String(cell)))
        : [],
      box_2d: Array.isArray(d.box_2d)
        ? geminiBoxToPixels(d.box_2d as number[], width, height)
        : undefined,
    }))
    .filter((t) => t.columns.length > 0 || t.rows.length > 0);

  return { imageType, textBlocks, objects, tables };
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
