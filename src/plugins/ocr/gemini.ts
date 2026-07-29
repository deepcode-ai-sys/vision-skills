/**
 * Gemini OCR plugin (FREE tier).
 *
 * Uses Gemini to extract text with bounding boxes. Returns normalized
 * text_blocks. Free at Google AI Studio, no credit card required.
 */

import { BasePlugin } from '../base.js';
import type { PluginType, RequestContext } from '../../core/types.js';
import { callGemini, geminiBoxToPixels, stripFences } from '../gemini/client.js';

const PROMPT = `Extract ALL text visible in this image. For each distinct text block, return its text content and bounding box.
Preserve original language and diacritics (e.g. Vietnamese).
Respond with ONLY a JSON array (no markdown), each item shaped exactly:
[{"text": "...", "box_2d": [ymin, xmin, ymax, xmax], "language": "vi"}]
where box_2d values are integers 0-1000 normalized to image dimensions.
If there is no text, respond with [].`;

export class GeminiOCRPlugin extends BasePlugin {
  readonly name = 'gemini_ocr';
  readonly pluginType: PluginType = 'ocr';
  readonly provider = 'gemini';
  override readonly costEstimate = 0; // free tier

  constructor(
    private apiKey?: string,
    private model = 'gemini-2.0-flash',
  ) {
    super();
  }

  protected async run(
    image: Buffer,
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    const raw = await callGemini({
      apiKey: this.apiKey!,
      model: this.model,
      prompt: PROMPT,
      imageBase64: image.toString('base64'),
      timeoutMs: this.timeoutMs,
      jsonOutput: true,
    });
    return this.parse(raw, context.imageWidth, context.imageHeight);
  }

  parse(raw: string, width: number, height: number): Record<string, unknown> {
    let data: unknown;
    try {
      data = JSON.parse(stripFences(raw));
    } catch {
      return { confidence: 0, text_blocks: [], full_text: '' };
    }
    if (!Array.isArray(data)) return { confidence: 0, text_blocks: [], full_text: '' };

    const textBlocks = data
      .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
      .map((d) => ({
        text: String(d.text ?? ''),
        bbox: geminiBoxToPixels((d.box_2d as number[]) ?? [], width, height),
        confidence: 0.9,
        language: (d.language as string) ?? null,
      }))
      .filter((b) => b.text.trim().length > 0);

    const fullText = textBlocks.map((b) => b.text).join('\n');
    return {
      confidence: textBlocks.length > 0 ? 0.9 : 0,
      text_blocks: textBlocks,
      full_text: fullText,
    };
  }

  async healthCheck(): Promise<boolean> {
    return Boolean(this.apiKey);
  }
}
