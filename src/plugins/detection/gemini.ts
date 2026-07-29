/**
 * Gemini object detection plugin (FREE tier).
 *
 * Gemini 2.0 returns real bounding boxes for objects. Free at Google AI
 * Studio. Converts box_2d [ymin,xmin,ymax,xmax] (0-1000) to pixel bbox.
 */

import { BasePlugin } from '../base.js';
import type { PluginType, RequestContext } from '../../core/types.js';
import { callGemini, geminiBoxToPixels, stripFences } from '../gemini/client.js';

const PROMPT = `Detect all prominent objects in this image. For each object, return its label and bounding box.
Respond with ONLY a JSON array (no markdown), each item shaped exactly:
[{"label": "person", "box_2d": [ymin, xmin, ymax, xmax], "confidence": 0.95}]
where box_2d values are integers 0-1000 normalized to image dimensions.
Use concise lowercase labels. If there are no clear objects, respond with [].`;

export class GeminiDetectionPlugin extends BasePlugin {
  readonly name = 'gemini_detection';
  readonly pluginType: PluginType = 'detection';
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
      return { confidence: 0, objects: [] };
    }
    if (!Array.isArray(data)) return { confidence: 0, objects: [] };

    const objects = data
      .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
      .map((d) => ({
        label: String(d.label ?? 'object'),
        bbox: geminiBoxToPixels((d.box_2d as number[]) ?? [], width, height),
        confidence: Number(d.confidence ?? 0.85),
      }))
      .filter((o) => o.label.trim().length > 0);

    const overall =
      objects.length > 0
        ? objects.reduce((s, o) => s + o.confidence, 0) / objects.length
        : 0;
    return { confidence: Math.round(overall * 1000) / 1000, objects };
  }

  async healthCheck(): Promise<boolean> {
    return Boolean(this.apiKey);
  }
}
