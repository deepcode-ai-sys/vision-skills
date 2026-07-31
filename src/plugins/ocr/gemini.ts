/**
 * Gemini OCR plugin (FREE tier).
 *
 * Uses Gemini to extract text with bounding boxes. Returns normalized
 * text_blocks. Free at Google AI Studio, no credit card required.
 */

import { BasePlugin } from '../base.js';
import type { PluginType, RequestContext } from '../../core/types.js';
import { analyzeCombined } from '../gemini/analyzer.js';
import { GeminiKeyPool } from '../gemini/key-pool.js';

export class GeminiOCRPlugin extends BasePlugin {
  readonly name = 'gemini_ocr';
  readonly pluginType: PluginType = 'ocr';
  readonly provider = 'gemini';
  override readonly costEstimate = 0; // free tier
  // Orchestrator budget (total, across key rotation). Very dense images
  // (e.g. full web pages) can take 30-60s for the combined extraction,
  // so the budget must allow a long single attempt + rotation.
  override readonly timeoutMs = 120000;
  // Per-attempt fetch timeout. Dense images with huge JSON output can take
  // 30-60s; 45s gives headroom. Rate-limited/bad keys fail fast (~200ms).
  private readonly perAttemptTimeoutMs = 45000;

  private keyPool: GeminiKeyPool;

  constructor(
    keys: string | string[] | GeminiKeyPool | undefined,
    private model = 'gemini-flash-lite-latest',
    private depth: 'fast' | 'deep' = 'fast',
  ) {
    super();
    this.keyPool =
      keys instanceof GeminiKeyPool
        ? keys
        : new GeminiKeyPool(typeof keys === 'string' ? [keys] : (keys ?? []));
  }

  protected async run(
    image: Buffer,
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    // Shared single Gemini call (memoized per request) covers OCR + detection.
    const combined = await analyzeCombined(
      this.keyPool,
      this.model,
      image,
      context,
      this.perAttemptTimeoutMs,
      { depth: this.depth },
    );
    const fullText = combined.textBlocks.map((b) => b.text).join('\n');
    return {
      confidence: combined.textBlocks.length > 0 ? 0.9 : 0,
      text_blocks: combined.textBlocks,
      full_text: fullText,
    };
  }

  async healthCheck(): Promise<boolean> {
    return this.keyPool.hasKeys;
  }
}
