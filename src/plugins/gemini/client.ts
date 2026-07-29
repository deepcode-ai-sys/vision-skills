/**
 * Shared Google Gemini API helper.
 *
 * Gemini has a FREE tier (Google AI Studio, no credit card). A single VLM
 * covers OCR, detection (with bounding boxes), and reasoning.
 *
 * generateContent API:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}
 *
 * Gemini 2.0 returns bounding boxes as [ymin, xmin, ymax, xmax] normalized
 * to 0-1000. Helpers here convert to our [x1,y1,x2,y2] pixel format.
 */

import { ProviderError } from '../../core/errors.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiCallOptions {
  apiKey: string;
  model: string;
  prompt: string;
  imageBase64: string;
  timeoutMs?: number;
  /** Ask Gemini to return JSON (sets responseMimeType). */
  jsonOutput?: boolean;
}

/** Call Gemini generateContent with an image + prompt, return the text. */
export async function callGemini(opts: GeminiCallOptions): Promise<string> {
  const { apiKey, model, prompt, imageBase64, timeoutMs = 20000, jsonOutput } = opts;

  const body: Record<string, unknown> = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
          { text: prompt },
        ],
      },
    ],
  };
  if (jsonOutput) {
    body.generationConfig = { responseMimeType: 'application/json' };
  }

  const url = `${BASE}/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ProviderError(
      `Gemini returned HTTP ${response.status}: ${text.slice(0, 200)}`,
      'gemini',
    );
  }

  const result = (await response.json()) as Record<string, unknown>;
  return extractText(result);
}

function extractText(result: Record<string, unknown>): string {
  const candidates = result.candidates as Array<Record<string, unknown>> | undefined;
  if (!candidates || candidates.length === 0) {
    // Could be blocked by safety filters
    const feedback = result.promptFeedback as Record<string, unknown> | undefined;
    if (feedback?.blockReason) {
      throw new ProviderError(`Gemini blocked: ${feedback.blockReason}`, 'gemini');
    }
    return '';
  }
  const content = candidates[0]!.content as Record<string, unknown> | undefined;
  const parts = (content?.parts as Array<Record<string, unknown>>) ?? [];
  return parts.map((p) => (p.text as string) ?? '').join('');
}

/** Strip markdown code fences from a model response. */
export function stripFences(raw: string): string {
  let text = raw.trim();
  if (text.startsWith('```')) {
    const parts = text.split('```');
    if (parts.length >= 2) {
      text = parts[1]!.replace(/^json/i, '').trim();
    }
  }
  return text;
}

/**
 * Convert a Gemini bounding box [ymin, xmin, ymax, xmax] (0-1000 normalized)
 * to our [x1, y1, x2, y2] pixel format.
 */
export function geminiBoxToPixels(
  box: number[],
  width: number,
  height: number,
): [number, number, number, number] {
  if (box.length !== 4) return [0, 0, 0, 0];
  const [ymin, xmin, ymax, xmax] = box as [number, number, number, number];
  return [
    Math.round((xmin / 1000) * width * 10) / 10,
    Math.round((ymin / 1000) * height * 10) / 10,
    Math.round((xmax / 1000) * width * 10) / 10,
    Math.round((ymax / 1000) * height * 10) / 10,
  ];
}
