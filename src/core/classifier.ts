/**
 * Rule-based image classifier.
 *
 * Determines image type (real_world / screen_ui / document / mixed) using
 * lightweight heuristics via sharp: aspect ratio, EXIF presence, color
 * variety (channel entropy/stddev), and edge density estimate.
 *
 * Layer 2 (CLIP-based) is a future enhancement; when confidence is low we
 * fail safe to `mixed`.
 */

import sharp from 'sharp';

import type { ClassificationResult, ImageCharacteristics, ImageType } from './types.js';

export class ImageClassifier {
  constructor(private finalThreshold = 0.6) {}

  async classify(image: Buffer): Promise<ClassificationResult> {
    const characteristics = await this.extractCharacteristics(image);
    const [voted, confidence] = this.vote(characteristics);

    // Fail-safe: low confidence -> mixed (router will pick Standard)
    const type = confidence < this.finalThreshold ? 'mixed' : voted;

    return {
      type,
      confidence: Math.round(confidence * 1000) / 1000,
      classifierLayerUsed: 'rule_based',
      characteristics,
    };
  }

  private async extractCharacteristics(image: Buffer): Promise<ImageCharacteristics> {
    const img = sharp(image, { failOn: 'none' });
    const meta = await img.metadata();
    const width = meta.width ?? 1;
    const height = meta.height ?? 1;
    const aspectRatio = height > 0 ? width / height : 1;
    const hasExif = Boolean(meta.exif && meta.exif.length > 0);

    // Color variety via channel statistics
    const stats = await sharp(image, { failOn: 'none' }).stats();
    const avgStdev =
      stats.channels.reduce((sum, c) => sum + c.stdev, 0) / stats.channels.length;
    // Entropy (sharp provides it) — high entropy suggests a photo
    const entropy = stats.entropy ?? 0;

    // Edge density estimate: shrink to grayscale, apply a Laplacian-like
    // convolution, measure mean absolute response.
    const edgeDensity = await this.estimateEdgeDensity(image);

    const hasUiElements = edgeDensity > 0.12;
    const isPhoto = entropy > 6.5 && avgStdev > 40 && edgeDensity < 0.12;
    // Text presence is approximated by moderate-high edge density + lower entropy
    const hasText = edgeDensity > 0.08 && entropy < 7.2;

    return { hasUiElements, hasText, isPhoto, aspectRatio, hasExif };
  }

  private async estimateEdgeDensity(image: Buffer): Promise<number> {
    try {
      // Downscale to speed up, grayscale, edge kernel
      const size = 256;
      const gray = sharp(image, { failOn: 'none' })
        .greyscale()
        .resize(size, size, { fit: 'fill' });

      const edged = await gray
        .convolve({
          width: 3,
          height: 3,
          kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
        })
        .raw()
        .toBuffer();

      // Mean absolute response normalized to 0..1
      let sum = 0;
      for (let i = 0; i < edged.length; i++) {
        sum += edged[i]!;
      }
      const mean = sum / edged.length;
      return Math.min(mean / 128, 1);
    } catch {
      return 0;
    }
  }

  private vote(ch: ImageCharacteristics): [ImageType, number] {
    const scores: Record<Exclude<ImageType, 'mixed'>, number> = {
      screen_ui: 0,
      real_world: 0,
      document: 0,
    };

    if (this.isScreenRatio(ch.aspectRatio)) {
      scores.screen_ui += 0.25;
    } else if (ch.aspectRatio > 0.6 && ch.aspectRatio < 0.85) {
      scores.document += 0.15;
    }

    if (ch.hasUiElements) {
      scores.screen_ui += 0.3;
      scores.document += 0.15;
    } else {
      scores.real_world += 0.2;
    }

    if (ch.hasText) {
      scores.document += 0.25;
      scores.screen_ui += 0.15;
    }

    if (ch.isPhoto) {
      scores.real_world += 0.4;
    }

    if (ch.hasExif) {
      scores.real_world += 0.25;
    } else {
      scores.screen_ui += 0.1;
    }

    const entries = Object.entries(scores) as [Exclude<ImageType, 'mixed'>, number][];
    let winner = entries[0]![0];
    let max = entries[0]![1];
    let total = 0;
    for (const [k, v] of entries) {
      total += v;
      if (v > max) {
        max = v;
        winner = k;
      }
    }
    const confidence = total > 0 ? max / total : 0;
    return [winner, confidence];
  }

  private isScreenRatio(ar: number, tol = 0.08): boolean {
    const common = [16 / 9, 9 / 16, 4 / 3, 3 / 4, 16 / 10, 10 / 16, 1.0];
    return common.some((r) => Math.abs(ar - r) < tol);
  }
}
