/**
 * Provider Orchestrator.
 *
 * Registers plugins by type and runs the required types for a mode.
 * Independent types run in parallel; within a type, providers are tried in
 * priority order (fallback) with a simple circuit breaker.
 */

import type { PluginResult, PluginType, RequestContext } from './types.js';
import type { VisionPlugin } from '../plugins/base.js';

export class ProviderOrchestrator {
  private plugins = new Map<PluginType, VisionPlugin[]>();
  private unhealthy = new Set<string>();

  register(plugin: VisionPlugin, priority?: number): void {
    const list = this.plugins.get(plugin.pluginType) ?? [];
    if (priority === undefined) {
      list.push(plugin);
    } else {
      list.splice(priority, 0, plugin);
    }
    this.plugins.set(plugin.pluginType, list);
  }

  getPlugins(type: PluginType): VisionPlugin[] {
    return this.plugins.get(type) ?? [];
  }

  clear(): void {
    this.plugins.clear();
    this.unhealthy.clear();
  }

  /** Run all required plugin types. Independent types run in parallel. */
  async run(
    image: Buffer,
    context: RequestContext,
    pluginTypes: PluginType[],
  ): Promise<PluginResult[]> {
    const settled = await Promise.allSettled(
      pluginTypes.map((t) => this.runTypeWithFallback(t, image, context)),
    );

    const results: PluginResult[] = [];
    settled.forEach((r, i) => {
      const type = pluginTypes[i]!;
      if (r.status === 'fulfilled' && r.value) {
        results.push(r.value);
      } else if (r.status === 'rejected') {
        results.push(this.errorResult(type, String(r.reason)));
      }
    });
    return results;
  }

  private async runTypeWithFallback(
    type: PluginType,
    image: Buffer,
    context: RequestContext,
  ): Promise<PluginResult | null> {
    const plugins = this.plugins.get(type) ?? [];
    if (plugins.length === 0) return null;

    let last: PluginResult | null = null;

    for (const plugin of plugins) {
      if (this.unhealthy.has(plugin.name)) {
        const ok = await this.recheck(plugin);
        if (!ok) continue;
      }

      let result: PluginResult;
      try {
        result = await this.withTimeout(
          plugin.process(image, context),
          plugin.timeoutMs,
        );
      } catch {
        this.unhealthy.add(plugin.name);
        last = this.errorResult(type, `Timeout after ${plugin.timeoutMs}ms`, plugin);
        continue;
      }

      last = result;
      if (result.errors.length === 0) {
        this.unhealthy.delete(plugin.name);
        return result;
      }
      this.unhealthy.add(plugin.name);
    }

    return last;
  }

  private async recheck(plugin: VisionPlugin): Promise<boolean> {
    try {
      const ok = await this.withTimeout(plugin.healthCheck(), 3000);
      if (ok) this.unhealthy.delete(plugin.name);
      return ok;
    } catch {
      return false;
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), ms);
      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }

  private errorResult(type: string, message: string, plugin?: VisionPlugin): PluginResult {
    return {
      plugin: plugin?.name ?? `${type}_unavailable`,
      provider: plugin?.provider ?? 'none',
      pluginVersion: '1.0',
      schemaVersion: '3.1',
      confidence: 0,
      latencyMs: 0,
      costActual: 0,
      data: {},
      errors: [message],
      warnings: [],
      piiFlagged: false,
    };
  }

  async healthReport(): Promise<Record<string, boolean>> {
    const report: Record<string, boolean> = {};
    for (const list of this.plugins.values()) {
      for (const plugin of list) {
        try {
          report[plugin.name] = await this.withTimeout(plugin.healthCheck(), 3000);
        } catch {
          report[plugin.name] = false;
        }
      }
    }
    return report;
  }
}
