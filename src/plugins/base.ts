/**
 * Base plugin contract for Vision Skills.
 *
 * Every provider plugin (OCR, detection, VLM, UI...) implements VisionPlugin.
 * The `process()` wrapper handles timing + error capture so subclasses only
 * implement `run()`.
 */

import type { PluginResult, PluginType, RequestContext } from '../core/types.js';

export interface VisionPlugin {
  readonly name: string;
  readonly pluginType: PluginType;
  readonly provider: string;
  readonly schemaVersionSupported: string;
  readonly pluginVersion: string;
  readonly costEstimate: number;
  readonly timeoutMs: number;
  readonly requiresPiiReview: boolean;

  /** Process an image, returning a normalized PluginResult. */
  process(image: Buffer, context: RequestContext): Promise<PluginResult>;

  /** Lightweight availability check (used for fallback decisions). */
  healthCheck(): Promise<boolean>;
}

/**
 * Abstract base implementing the process() envelope. Subclasses implement
 * `run()` which returns the raw provider data dict.
 */
export abstract class BasePlugin implements VisionPlugin {
  abstract readonly name: string;
  abstract readonly pluginType: PluginType;
  abstract readonly provider: string;

  readonly schemaVersionSupported: string = '3.1';
  readonly pluginVersion: string = '1.0';
  readonly costEstimate: number = 0;
  readonly timeoutMs: number = 8000;
  readonly requiresPiiReview: boolean = false;

  /** Provider-specific implementation. Throw on failure. */
  protected abstract run(
    image: Buffer,
    context: RequestContext,
  ): Promise<Record<string, unknown>>;

  abstract healthCheck(): Promise<boolean>;

  async process(image: Buffer, context: RequestContext): Promise<PluginResult> {
    const start = performance.now();
    const result: PluginResult = {
      plugin: this.name,
      provider: this.provider,
      pluginVersion: this.pluginVersion,
      schemaVersion: this.schemaVersionSupported,
      confidence: 0,
      latencyMs: 0,
      costActual: 0,
      data: {},
      errors: [],
      warnings: [],
      piiFlagged: false,
    };

    try {
      const data = await this.run(image, context);
      result.data = data;
      result.confidence = typeof data.confidence === 'number' ? data.confidence : 1.0;
      result.costActual = this.costEstimate;
    } catch (err) {
      const e = err as Error;
      result.errors.push(`${e.name}: ${e.message}`);
    } finally {
      result.latencyMs = performance.now() - start;
    }

    return result;
  }
}
