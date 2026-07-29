/**
 * Gemini object detection plugin (FREE tier).
 *
 * Gemini 2.0 returns real bounding boxes for objects. Free at Google AI
 * Studio. Converts box_2d [ymin,xmin,ymax,xmax] (0-1000) to pixel bbox.
 */

import { BasePlugin } from '../base.js';
import type { PluginType, RequestContext } from '../../core/types.js';
import { analyzeCombined } from '../gemini/analyzer.js';

export class GeminiDetectionPlugin extends BasePlugin {
  readonly name = 'gemini_detection';
  readonly pluginType: PluginType = 'detection';
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
    const objects = combined.objects;
    const overall =
      objects.length > 0 ? objects.reduce((s, o) => s + o.confidence, 0) / objects.length : 0;
    return { confidence: Math.round(overall * 1000) / 1000, objects };
  }

  async healthCheck(): Promise<boolean> {
    return Boolean(this.apiKey);
  }
}
