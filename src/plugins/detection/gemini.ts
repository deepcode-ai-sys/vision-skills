/**
 * Gemini object detection plugin (FREE tier).
 *
 * Gemini 2.0 returns real bounding boxes for objects. Free at Google AI
 * Studio. Converts box_2d [ymin,xmin,ymax,xmax] (0-1000) to pixel bbox.
 */

import { BasePlugin } from '../base.js';
import type { PluginType, RequestContext } from '../../core/types.js';
import { analyzeCombined } from '../gemini/analyzer.js';
import { GeminiKeyPool } from '../gemini/key-pool.js';

export class GeminiDetectionPlugin extends BasePlugin {
  readonly name = 'gemini_detection';
  readonly pluginType: PluginType = 'detection';
  readonly provider = 'gemini';
  override readonly costEstimate = 0; // free tier
  // Orchestrator budget (total, across key rotation). flash-lite ~4-8s/call.
  override readonly timeoutMs = 60000;
  // Per-attempt fetch timeout. flash-lite dense-image calls ~4-8s; 20s headroom.
  private readonly perAttemptTimeoutMs = 20000;

  private keyPool: GeminiKeyPool;

  constructor(
    keys: string | string[] | GeminiKeyPool | undefined,
    private model = 'gemini-flash-lite-latest',
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
    );
    const objects = combined.objects;
    const overall =
      objects.length > 0 ? objects.reduce((s, o) => s + o.confidence, 0) / objects.length : 0;
    return { confidence: Math.round(overall * 1000) / 1000, objects };
  }

  async healthCheck(): Promise<boolean> {
    return this.keyPool.hasKeys;
  }
}
