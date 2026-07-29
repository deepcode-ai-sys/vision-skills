/**
 * Rule-based UI element detector.
 *
 * Local (no API cost) detector that finds rectangular UI-like regions using
 * sharp edge detection + a lightweight connected-component scan, then
 * classifies rectangles into button / input_field / container by shape.
 *
 * This is a heuristic complement to OCR; it is intentionally conservative.
 */

import sharp from 'sharp';

import { BasePlugin } from '../base.js';
import type { PluginType, RequestContext } from '../../core/types.js';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class RuleBasedUIPlugin extends BasePlugin {
  readonly name = 'rulebased_ui';
  readonly pluginType: PluginType = 'ui';
  readonly provider = 'local';
  override readonly costEstimate = 0;

  protected async run(
    image: Buffer,
    _context: RequestContext,
  ): Promise<Record<string, unknown>> {
    const { width, height, imageArea, rects } = await this.detectRects(image);
    const elements = rects
      .map((r) => this.toElement(r, imageArea))
      .filter((e): e is Record<string, unknown> => e !== null);

    const deduped = this.dedupe(elements);
    const overall =
      deduped.length > 0
        ? deduped.reduce((s, e) => s + (e.confidence as number), 0) / deduped.length
        : 0;

    return {
      confidence: Math.round(overall * 1000) / 1000,
      ui_elements: deduped,
      image_size: [width, height],
    };
  }

  /**
   * Detect axis-aligned rectangles by running an edge filter, then scanning
   * for horizontal/vertical line segments. This is a simplified detector
   * (full contour analysis would need OpenCV); it finds strong rectangular
   * boundaries which cover most UI buttons/inputs/containers.
   */
  private async detectRects(
    image: Buffer,
  ): Promise<{ width: number; height: number; imageArea: number; rects: Rect[] }> {
    const target = 256;
    const gray = sharp(image, { failOn: 'none' }).greyscale().resize(target, target, {
      fit: 'fill',
    });

    const { data, info } = await gray
      .convolve({
        width: 3,
        height: 3,
        kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
      })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info.width;
    const h = info.height;
    const meta = await sharp(image, { failOn: 'none' }).metadata();
    const realW = meta.width ?? w;
    const realH = meta.height ?? h;
    const scaleX = realW / w;
    const scaleY = realH / h;

    // Binarize edges
    const threshold = 40;
    const edge = new Uint8Array(w * h);
    for (let i = 0; i < data.length; i++) {
      edge[i] = data[i]! > threshold ? 1 : 0;
    }

    // Detect strong horizontal segments, then match top/bottom pairs with
    // vertical support to form rectangles.
    const rects = this.findRectangles(edge, w, h, scaleX, scaleY);
    return { width: realW, height: realH, imageArea: realW * realH, rects };
  }

  private findRectangles(
    edge: Uint8Array,
    w: number,
    h: number,
    scaleX: number,
    scaleY: number,
  ): Rect[] {
    const minRun = Math.floor(w * 0.05);
    // Find horizontal edge runs per row
    const horizontals: Array<{ y: number; x1: number; x2: number }> = [];
    for (let y = 0; y < h; y++) {
      let runStart = -1;
      for (let x = 0; x < w; x++) {
        const on = edge[y * w + x] === 1;
        if (on && runStart < 0) runStart = x;
        if ((!on || x === w - 1) && runStart >= 0) {
          const end = on ? x : x - 1;
          if (end - runStart >= minRun) {
            horizontals.push({ y, x1: runStart, x2: end });
          }
          runStart = -1;
        }
      }
    }

    // Pair horizontal segments that align in x-range to form a box
    const rects: Rect[] = [];
    const minGap = Math.floor(h * 0.02);
    for (let i = 0; i < horizontals.length; i++) {
      for (let j = i + 1; j < horizontals.length; j++) {
        const a = horizontals[i]!;
        const b = horizontals[j]!;
        if (b.y - a.y < minGap) continue;
        const x1 = Math.max(a.x1, b.x1);
        const x2 = Math.min(a.x2, b.x2);
        const overlap = x2 - x1;
        if (overlap < minRun) continue;
        // aligned enough
        if (Math.abs(a.x1 - b.x1) < w * 0.1 && Math.abs(a.x2 - b.x2) < w * 0.1) {
          rects.push({
            x: Math.round(x1 * scaleX),
            y: Math.round(a.y * scaleY),
            w: Math.round(overlap * scaleX),
            h: Math.round((b.y - a.y) * scaleY),
          });
        }
      }
    }
    return rects;
  }

  private toElement(rect: Rect, imageArea: number): Record<string, unknown> | null {
    const area = rect.w * rect.h;
    if (area < imageArea * 0.0005 || area > imageArea * 0.6) return null;
    if (rect.h === 0) return null;

    const aspect = rect.w / rect.h;
    let elementType = 'ui_region';
    let confidence = 0.4;

    if (aspect > 2 && aspect < 8 && area < imageArea * 0.05) {
      if (area < imageArea * 0.01) {
        elementType = 'button';
        confidence = 0.55;
      } else {
        elementType = 'input_field';
        confidence = 0.5;
      }
    } else if (aspect > 0.7 && aspect < 1.4 && area < imageArea * 0.005) {
      elementType = 'checkbox';
      confidence = 0.45;
    } else if (area > imageArea * 0.1) {
      elementType = 'container';
      confidence = 0.5;
    }

    return {
      label: elementType,
      element_type: elementType,
      bbox: [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h],
      confidence,
      clickable: ['button', 'checkbox', 'tab'].includes(elementType),
    };
  }

  private dedupe(
    elements: Array<Record<string, unknown>>,
    iouThreshold = 0.7,
  ): Array<Record<string, unknown>> {
    if (elements.length < 2) return elements;
    const sorted = [...elements].sort(
      (a, b) => (b.confidence as number) - (a.confidence as number),
    );
    const kept: Array<Record<string, unknown>> = [];
    for (const el of sorted) {
      const dup = kept.some((k) => this.iou(el.bbox as number[], k.bbox as number[]) > iouThreshold);
      if (!dup) kept.push(el);
    }
    return kept;
  }

  private iou(a: number[], b: number[]): number {
    const ix1 = Math.max(a[0]!, b[0]!);
    const iy1 = Math.max(a[1]!, b[1]!);
    const ix2 = Math.min(a[2]!, b[2]!);
    const iy2 = Math.min(a[3]!, b[3]!);
    const iw = Math.max(0, ix2 - ix1);
    const ih = Math.max(0, iy2 - iy1);
    const inter = iw * ih;
    const areaA = (a[2]! - a[0]!) * (a[3]! - a[1]!);
    const areaB = (b[2]! - b[0]!) * (b[3]! - b[1]!);
    const union = areaA + areaB - inter;
    return union > 0 ? inter / union : 0;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
