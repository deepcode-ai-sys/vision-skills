/**
 * Google Cloud Vision OCR plugin.
 *
 * Uses the images:annotate REST API with an API key (DOCUMENT_TEXT_DETECTION).
 * Converts response into normalized text_blocks with [x1,y1,x2,y2] bboxes.
 */

import { ProviderError } from '../../core/errors.js';
import { BasePlugin } from '../base.js';
import type { PluginType, RequestContext } from '../../core/types.js';

const ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';

export class GoogleVisionOCRPlugin extends BasePlugin {
  readonly name = 'google_vision_ocr';
  readonly pluginType: PluginType = 'ocr';
  readonly provider = 'google';
  override readonly costEstimate = 0.0015;

  constructor(private apiKey?: string) {
    super();
  }

  protected async run(
    image: Buffer,
    _context: RequestContext,
  ): Promise<Record<string, unknown>> {
    if (!this.apiKey) {
      throw new ProviderError('Google Cloud Vision API key not configured', this.name);
    }

    const payload = {
      requests: [
        {
          image: { content: image.toString('base64') },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
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

    return this.parse((await response.json()) as Record<string, unknown>);
  }

  parse(result: Record<string, unknown>): Record<string, unknown> {
    const responses = (result.responses as Record<string, unknown>[]) ?? [];
    if (responses.length === 0) {
      return { confidence: 0, text_blocks: [], full_text: '' };
    }
    const first = responses[0]!;
    if (first.error) {
      const err = first.error as { message?: string };
      throw new ProviderError(`Google Vision error: ${err.message ?? 'unknown'}`, this.name);
    }

    const textBlocks: Array<Record<string, unknown>> = [];
    let fullText = '';

    const fullAnnotation = first.fullTextAnnotation as Record<string, unknown> | undefined;
    if (fullAnnotation) {
      fullText = (fullAnnotation.text as string) ?? '';
      const pages = (fullAnnotation.pages as Record<string, unknown>[]) ?? [];
      for (const page of pages) {
        const blocks = (page.blocks as Record<string, unknown>[]) ?? [];
        for (const block of blocks) {
          const { text, confidence, bbox } = this.extractBlock(block);
          if (text.trim()) {
            textBlocks.push({ text: text.trim(), bbox, confidence, language: null });
          }
        }
      }
    } else {
      const annotations = (first.textAnnotations as Record<string, unknown>[]) ?? [];
      if (annotations.length > 0) {
        fullText = (annotations[0]!.description as string) ?? '';
        for (const ann of annotations.slice(1)) {
          const poly = ann.boundingPoly as Record<string, unknown> | undefined;
          const bbox = this.verticesToBbox(
            (poly?.vertices as Record<string, number>[]) ?? [],
          );
          textBlocks.push({
            text: ann.description ?? '',
            bbox,
            confidence: 0.9,
            language: ann.locale ?? null,
          });
        }
      }
    }

    const overall =
      textBlocks.length > 0
        ? textBlocks.reduce((s, b) => s + (b.confidence as number), 0) / textBlocks.length
        : 0;

    return {
      confidence: Math.round(overall * 1000) / 1000,
      text_blocks: textBlocks,
      full_text: fullText,
    };
  }

  private extractBlock(block: Record<string, unknown>): {
    text: string;
    confidence: number;
    bbox: number[];
  } {
    const confidence = Number(block.confidence ?? 0.9);
    const boundingBox = block.boundingBox as Record<string, unknown> | undefined;
    const bbox = this.verticesToBbox(
      (boundingBox?.vertices as Record<string, number>[]) ?? [],
    );
    const words: string[] = [];
    const paragraphs = (block.paragraphs as Record<string, unknown>[]) ?? [];
    for (const para of paragraphs) {
      const wordList = (para.words as Record<string, unknown>[]) ?? [];
      for (const word of wordList) {
        const symbols = (word.symbols as Record<string, unknown>[]) ?? [];
        words.push(symbols.map((s) => (s.text as string) ?? '').join(''));
      }
    }
    return { text: words.join(' '), confidence, bbox };
  }

  private verticesToBbox(vertices: Record<string, number>[]): number[] {
    if (vertices.length === 0) return [0, 0, 0, 0];
    const xs = vertices.map((v) => v.x ?? 0);
    const ys = vertices.map((v) => v.y ?? 0);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  async healthCheck(): Promise<boolean> {
    return Boolean(this.apiKey);
  }
}
