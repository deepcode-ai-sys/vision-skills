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

export interface CombinedResult {
  textBlocks: Array<{ text: string; bbox: number[]; confidence: number; language: string | null }>;
  objects: Array<{ label: string; bbox: number[]; confidence: number }>;
}

const PROMPT = `Analyze this image and extract BOTH text and objects in a single response.

Return ONLY a JSON object (no markdown) with this exact shape:
{
  "text_blocks": [{"text": "...", "box_2d": [ymin, xmin, ymax, xmax], "language": "vi"}],
  "objects": [{"label": "person", "box_2d": [ymin, xmin, ymax, xmax], "confidence": 0.95}]
}

Rules:
- box_2d values are integers 0-1000 normalized to image dimensions.
- Preserve original text and diacritics (e.g. Vietnamese).
- Use concise lowercase object labels.
- If there is no text, use an empty array. Same for objects.`;

// Per-context memoization: WeakMap keyed by the context object so entries are
// garbage-collected automatically when the request finishes.
const cache = new WeakMap<RequestContext, Promise<CombinedResult>>();

export async function analyzeCombined(
  apiKey: string,
  model: string,
  image: Buffer,
  context: RequestContext,
  timeoutMs: number,
): Promise<CombinedResult> {
  const existing = cache.get(context);
  if (existing) return existing;

  const promise = doAnalyze(apiKey, model, image, context, timeoutMs);
  cache.set(context, promise);
  return promise;
}

async function doAnalyze(
  apiKey: string,
  model: string,
  image: Buffer,
  context: RequestContext,
  timeoutMs: number,
): Promise<CombinedResult> {
  const raw = await callGemini({
    apiKey,
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
    return { textBlocks: [], objects: [] };
  }

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

  return { textBlocks, objects };
}
