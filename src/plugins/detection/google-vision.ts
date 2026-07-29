/**
 * Google Cloud Vision Object Detection plugin.
 *
 * Uses OBJECT_LOCALIZATION. Google returns normalized vertices (0..1) which
 * we convert to pixel coordinates using image dimensions from the context.
 */

import { ProviderError } from '../../core/errors.js';
import { BasePlugin } from '../base.js';
import type { PluginType, RequestContext } from '../../core/types.js';

const ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';

export class GoogleVisionDetectionPlugin extends BasePlugin {
  readonly name = 'google_vision_detection';
  readonly pluginType: PluginType = 'detection';
  readonly provider = 'google';
  override readonly costEstimate = 0.0015;

  constructor(private apiKey?: string) {
    super();
  }

  protected async run(
    image: Buffer,
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    if (!this.apiKey) {
      throw new ProviderError('Google Cloud Vision API key not configured', this.name);
    }

    const payload = {
      requests: [
        {
          image: { content: image.toString('base64') },
          features: [{ type: 'OBJECT_LOCALIZATION' }],
        },
      ],
    };

    const response = await fetch(`${ENDPOINT}?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ProviderError(
        `Google Vision returned HTTP ${response.status}: ${body.slice(0, 200)}`,
        this.name,
      );
    }

    return this.parse(
      (await response.json()) as Record<string, unknown>,
      context.imageWidth,
      context.imageHeight,
    );
  }

  parse(
    result: Record<string, unknown>,
    width: number,
    height: number,
  ): Record<string, unknown> {
    const responses = (result.responses as Record<string, unknown>[]) ?? [];
    if (responses.length === 0) return { confidence: 0, objects: [] };

    const first = responses[0]!;
    if (first.error) {
      const err = first.error as { message?: string };
      throw new ProviderError(`Google Vision error: ${err.message ?? 'unknown'}`, this.name);
    }

    const annotations =
      (first.localizedObjectAnnotations as Record<string, unknown>[]) ?? [];
    const objects = annotations.map((obj) => {
      const poly = obj.boundingPoly as Record<string, unknown> | undefined;
      const vertices = (poly?.normalizedVertices as Record<string, number>[]) ?? [];
      return {
        label: (obj.name as string) ?? 'object',
        bbox: this.normalizedToPixel(vertices, width, height),
        confidence: Number(obj.score ?? 0),
      };
    });

    const overall =
      objects.length > 0
        ? objects.reduce((s, o) => s + o.confidence, 0) / objects.length
        : 0;

    return { confidence: Math.round(overall * 1000) / 1000, objects };
  }

  private normalizedToPixel(
    vertices: Record<string, number>[],
    width: number,
    height: number,
  ): number[] {
    if (vertices.length === 0) return [0, 0, 0, 0];
    const xs = vertices.map((v) => (v.x ?? 0) * width);
    const ys = vertices.map((v) => (v.y ?? 0) * height);
    return [
      Math.round(Math.min(...xs) * 10) / 10,
      Math.round(Math.min(...ys) * 10) / 10,
      Math.round(Math.max(...xs) * 10) / 10,
      Math.round(Math.max(...ys) * 10) / 10,
    ];
  }

  async healthCheck(): Promise<boolean> {
    return Boolean(this.apiKey);
  }
}
