/**
 * Multi-region (tiled) analysis for large/dense images.
 *
 * A single Gemini pass on a downscaled large image misses small text (the
 * "41 vs 95 blocks" instability). This splits the image into overlapping
 * tiles, analyzes each tile at higher effective resolution, then maps tile
 * coordinates back to the full image and merges + dedupes the results.
 *
 * Cost note: N tiles = N Gemini calls. Only worth it for large/dense images,
 * so it's gated behind analysisDepth='deep' and an image-size threshold.
 */

import sharp from 'sharp';

import type { RequestContext } from '../../core/types.js';
import { callGemini, stripFences } from './client.js';
import type { GeminiKeyPool } from './key-pool.js';
import type { CombinedResult } from './analyzer.js';

interface Tile {
  left: number;
  top: number;
  width: number;
  height: number;
  buffer: Buffer;
}

const TILE_PROMPT = `You are reading a CROP of a larger screenshot/image. Read EVERY piece of text in this crop exhaustively, including small labels, numbers with units, timestamps, and button text. Also list any distinct objects.

Return ONLY a JSON object (no markdown):
{
  "text_blocks": [{"text": "...", "box_2d": [ymin, xmin, ymax, xmax], "language": "vi"}],
  "objects": [{"label": "...", "box_2d": [ymin, xmin, ymax, xmax], "confidence": 0.9}]
}
box_2d are integers 0-1000 normalized to THIS crop's dimensions. Preserve diacritics. Empty arrays allowed.`;

/**
 * Decide tiling grid based on image size. Returns [cols, rows]. Returns
 * [1,1] (no tiling) for smaller images.
 */
export function tileGrid(width: number, height: number): [number, number] {
  const longEdge = Math.max(width, height);
  // Only tile genuinely large images; otherwise a single pass is fine.
  if (longEdge < 1400) return [1, 1];
  const cols = width >= 1600 ? 2 : 1;
  const rows = height >= 1200 ? 2 : height >= 800 ? 2 : 1;
  return [cols, rows];
}

async function makeTiles(image: Buffer, cols: number, rows: number): Promise<Tile[]> {
  const meta = await sharp(image).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (W === 0 || H === 0) return [];

  // 12% overlap so text on tile boundaries isn't cut in half.
  const overlapX = Math.floor((W / cols) * 0.12);
  const overlapY = Math.floor((H / rows) * 0.12);
  const baseW = Math.ceil(W / cols);
  const baseH = Math.ceil(H / rows);

  const tiles: Tile[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const left = Math.max(0, c * baseW - overlapX);
      const top = Math.max(0, r * baseH - overlapY);
      const width = Math.min(W - left, baseW + overlapX * 2);
      const height = Math.min(H - top, baseH + overlapY * 2);
      if (width <= 0 || height <= 0) continue;
      const buffer = await sharp(image)
        .extract({ left, top, width, height })
        .jpeg({ quality: 90 })
        .toBuffer();
      tiles.push({ left, top, width, height, buffer });
    }
  }
  return tiles;
}

/** Convert a tile-local box_2d (0-1000) to full-image pixel [x1,y1,x2,y2]. */
function tileBoxToFull(box: number[], tile: Tile): number[] {
  if (box.length !== 4) return [0, 0, 0, 0];
  const [ymin, xmin, ymax, xmax] = box;
  const x1 = tile.left + (xmin / 1000) * tile.width;
  const y1 = tile.top + (ymin / 1000) * tile.height;
  const x2 = tile.left + (xmax / 1000) * tile.width;
  const y2 = tile.top + (ymax / 1000) * tile.height;
  return [
    Math.round(x1 * 10) / 10,
    Math.round(y1 * 10) / 10,
    Math.round(x2 * 10) / 10,
    Math.round(y2 * 10) / 10,
  ];
}

/**
 * Analyze an image by tiles and merge. `base` is the result from the normal
 * whole-image pass (used to keep image_type + tables + seed dedupe).
 */
export async function analyzeMultiRegion(
  keyPool: GeminiKeyPool,
  model: string,
  image: Buffer,
  context: RequestContext,
  timeoutMs: number,
  base: CombinedResult,
): Promise<CombinedResult> {
  const [cols, rows] = tileGrid(context.imageWidth, context.imageHeight);
  if (cols * rows <= 1) return base; // not worth tiling

  const tiles = await makeTiles(image, cols, rows);
  context.signal?.throwIfAborted();

  // Analyze tiles in parallel (key pool handles rate limits/rotation).
  const tileResults = await Promise.all(
    tiles.map(async (tile) => {
      context.signal?.throwIfAborted();
      try {
        const raw = await callGemini({
          keyPool,
          model,
          prompt: TILE_PROMPT,
          imageBase64: tile.buffer.toString('base64'),
          timeoutMs,
          jsonOutput: true,
          context,
        });
        return { tile, data: JSON.parse(stripFences(raw)) as Record<string, unknown> };
      } catch {
        return { tile, data: {} as Record<string, unknown> };
      }
    }),
  );

  // Start from the whole-image results, then add tile findings.
  const textBlocks = [...base.textBlocks];
  const objects = [...base.objects];

  for (const { tile, data } of tileResults) {
    const rawTexts = Array.isArray(data.text_blocks) ? data.text_blocks : [];
    for (const d of rawTexts) {
      if (typeof d !== 'object' || d === null) continue;
      const rec = d as Record<string, unknown>;
      const text = String(rec.text ?? '').trim();
      if (!text) continue;
      textBlocks.push({
        text,
        bbox: tileBoxToFull((rec.box_2d as number[]) ?? [], tile),
        confidence: 0.9,
        language: (rec.language as string) ?? null,
      });
    }
    const rawObjects = Array.isArray(data.objects) ? data.objects : [];
    for (const d of rawObjects) {
      if (typeof d !== 'object' || d === null) continue;
      const rec = d as Record<string, unknown>;
      const label = String(rec.label ?? '').trim();
      if (!label) continue;
      objects.push({
        label,
        bbox: tileBoxToFull((rec.box_2d as number[]) ?? [], tile),
        confidence: Number(rec.confidence ?? 0.85),
      });
    }
  }

  return {
    imageType: base.imageType,
    tables: base.tables,
    code: base.code,
    regions: base.regions,
    layout: base.layout,
    warnings: base.warnings,
    textBlocks: dedupeText(textBlocks),
    objects: dedupeObjects(objects),
  };
}

/** Merge text blocks that are the same text at ~the same location. */
function dedupeText(blocks: CombinedResult['textBlocks']): CombinedResult['textBlocks'] {
  const out: CombinedResult['textBlocks'] = [];
  for (const b of blocks) {
    const dup = out.find(
      (o) => o.text === b.text && iou(o.bbox, b.bbox) > 0.3,
    );
    if (!dup) out.push(b);
  }
  return out;
}

function dedupeObjects(objs: CombinedResult['objects']): CombinedResult['objects'] {
  const out: CombinedResult['objects'] = [];
  for (const o of objs) {
    const dup = out.find((x) => x.label === o.label && iou(x.bbox, o.bbox) > 0.5);
    if (!dup) out.push(o);
    else if (o.confidence > dup.confidence) dup.confidence = o.confidence;
  }
  return out;
}

function iou(a: number[], b: number[]): number {
  if (a.length !== 4 || b.length !== 4) return 0;
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
