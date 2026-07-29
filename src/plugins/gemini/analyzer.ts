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

export interface CombinedResult {
  imageType: ImageType | null;
  textBlocks: Array<{ text: string; bbox: number[]; confidence: number; language: string | null }>;
  objects: Array<{ label: string; bbox: number[]; confidence: number }>;
}

const PROMPT = `Analyze this image and, in a SINGLE response, classify it and extract text and objects.

Return ONLY a JSON object (no markdown) with this exact shape:
{
  "image_type": "real_world | screen_ui | document | mixed",
  "text_blocks": [{"text": "...", "box_2d": [ymin, xmin, ymax, xmax], "language": "vi"}],
  "objects": [{"label": "person", "box_2d": [ymin, xmin, ymax, xmax], "confidence": 0.95}]
}

Rules:
- image_type: "screen_ui" for app/website/software screenshots; "document"
  for scanned/photographed paper or text documents; "real_world" for photos
  of people/objects/scenes; "mixed" only if genuinely unclear.
- box_2d values are integers 0-1000 normalized to image dimensions.
- Preserve original text and diacritics (e.g. Vietnamese).
- Use concise lowercase object labels.
- If there is no text, use an empty array. Same for objects.`;

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
    return { imageType: null, textBlocks: [], objects: [] };
  }

  const rawType = data.image_type as string | undefined;
  const imageType =
    rawType && VALID_TYPES.has(rawType) ? (rawType as ImageType) : null;

  const rawTexts = Array.isArray(data.text_blocks) ? data.text_blocks : [];
  const rawObjects = Array.isArray(data.objects) ? data.objects : [];

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

  return { imageType, textBlocks, objects };
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
