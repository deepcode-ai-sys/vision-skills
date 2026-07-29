/**
 * Gemini OCR plugin (FREE tier).
 *
 * Uses Gemini to extract text with bounding boxes. Returns normalized
 * text_blocks. Free at Google AI Studio, no credit card required.
 */

import { BasePlugin } from '../base.js';
import type { PluginType, RequestContext } from '../../core/types.js';
import { analyzeCombined } from '../gemini/analyzer.js';

export class GeminiOCRPlugin extends BasePlugin {
  readonly name = 'gemini_ocr';
  readonly pluginType: PluginType = 'ocr';
  readonly provider = 'gemini';
  override readonly costEstimate = 0; // free tier
  // gemini-2.5-flash uses reasoning and can take 10-20s; allow headroom.
  override readonly timeoutMs = 30000;

  constructor(
    private apiKey?: string,
    private model = 'gemini-2.5-flash',
  ) {
    super();
  }

  protected async run(
    image: Buffer,
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    // Shared single Gemini call (memoized per request) covers OCR + detection.
    const combined = await analyzeCombined(
      this.apiKey!,
      this.model,
      image,
      context,
      this.timeoutMs,
    );
    const fullText = combined.textBlocks.map((b) => b.text).join('\n');
    return {
      confidence: combined.textBlocks.length > 0 ? 0.9 : 0,
      text_blocks: combined.textBlocks,
      full_text: fullText,
    };
  }

  async healthCheck(): Promise<boolean> {
    return Boolean(this.apiKey);
  }
}
