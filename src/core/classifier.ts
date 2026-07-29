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

/** Internal signal set (superset of the public ImageCharacteristics). */
interface Signals extends ImageCharacteristics {
  brightBackground: boolean;
  lowColorVariety: boolean;
  edgeDensity: number;
}

export class ImageClassifier {
  constructor(private finalThreshold = 0.6) {}

  async classify(image: Buffer): Promise<ClassificationResult> {
    const signals = await this.extractSignals(image);
    const [voted, confidence] = this.vote(signals);

    // Fail-safe: low confidence -> mixed (router will pick Standard)
    const type = confidence < this.finalThreshold ? 'mixed' : voted;

    // Return only the public subset in characteristics.
    const characteristics: ImageCharacteristics = {
      hasUiElements: signals.hasUiElements,
      hasText: signals.hasText,
      isPhoto: signals.isPhoto,
      aspectRatio: signals.aspectRatio,
      hasExif: signals.hasExif,
    };

    return {
      type,
      confidence: Math.round(confidence * 1000) / 1000,
      classifierLayerUsed: 'rule_based',
      characteristics,
    };
  }

  private async extractSignals(image: Buffer): Promise<Signals> {
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
    const avgMean =
      stats.channels.reduce((sum, c) => sum + c.mean, 0) / stats.channels.length;
    // Entropy (sharp provides it) — high entropy suggests a photo
    const entropy = stats.entropy ?? 0;

    // Edge density estimate: shrink to grayscale, apply a Laplacian-like
    // convolution, measure mean absolute response.
    const edgeDensity = await this.estimateEdgeDensity(image);

    // Store richer signals on characteristics via derived flags.
    // - Documents: bright background (high mean), text edges, low color variety.
    // - UI: flat color regions (low-ish entropy) + straight edges.
    // - Photos: high entropy + high color variety + few straight edges.
    const brightBackground = avgMean > 180;
    const lowColorVariety = entropy < 6.0;

    const hasUiElements = edgeDensity > 0.12 && !brightBackground;
    const isPhoto = entropy > 6.8 && avgStdev > 45 && edgeDensity < 0.12;
    const hasText = edgeDensity > 0.07 && entropy < 7.4;

    return {
      hasUiElements,
      hasText,
      isPhoto,
      aspectRatio,
      hasExif,
      brightBackground,
      lowColorVariety,
      edgeDensity,
    };
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

  private vote(s: Signals): [ImageType, number] {
    const scores: Record<Exclude<ImageType, 'mixed'>, number> = {
      screen_ui: 0,
      real_world: 0,
      document: 0,
    };

    // --- Aspect ratio ---
    if (this.isScreenRatio(s.aspectRatio)) {
      scores.screen_ui += 0.2;
    } else if (s.aspectRatio > 0.6 && s.aspectRatio < 0.85) {
      // Portrait A4-ish → document leaning
      scores.document += 0.2;
    }

    // --- Photo signal (strongest single discriminator) ---
    if (s.isPhoto) {
      scores.real_world += 0.5;
    }

    // --- EXIF: real camera metadata ---
    if (s.hasExif) {
      scores.real_world += 0.3;
    } else {
      // No EXIF slightly favors synthetic images (UI/doc)
      scores.screen_ui += 0.05;
      scores.document += 0.05;
    }

    // --- Bright background + text → document (scanned page / paper) ---
    if (s.brightBackground && s.hasText) {
      scores.document += 0.4;
    } else if (s.brightBackground) {
      scores.document += 0.15;
    }

    // --- UI elements (straight edges, flat regions, not bright paper) ---
    if (s.hasUiElements) {
      scores.screen_ui += 0.4;
    }

    // --- Flat color regions (low entropy) → synthetic UI, not a photo ---
    if (s.lowColorVariety && !s.isPhoto) {
      scores.screen_ui += 0.2;
    }

    // --- Text present but not on bright paper → likely UI text ---
    if (s.hasText && !s.brightBackground) {
      scores.screen_ui += 0.15;
      scores.document += 0.1;
    }

    // Determine winner + runner-up for margin-based confidence.
    const entries = Object.entries(scores) as [Exclude<ImageType, 'mixed'>, number][];
    entries.sort((a, b) => b[1] - a[1]);
    const [winner, top] = entries[0]!;
    const second = entries[1]?.[1] ?? 0;
    const total = entries.reduce((sum, [, v]) => sum + v, 0);

    if (total === 0) {
      return [winner, 0];
    }

    // Confidence combines share-of-total and margin over runner-up.
    // This penalizes ambiguous cases (two close candidates → low confidence
    // → router falls back to Standard mode).
    const share = top / total;
    const margin = (top - second) / top; // 0 (tie) .. 1 (dominant)
    const confidence = Math.min(1, share * 0.6 + margin * 0.4);

    return [winner, confidence];
  }

  private isScreenRatio(ar: number, tol = 0.08): boolean {
    const common = [16 / 9, 9 / 16, 4 / 3, 3 / 4, 16 / 10, 10 / 16, 1.0];
    return common.some((r) => Math.abs(ar - r) < tol);
  }
}
