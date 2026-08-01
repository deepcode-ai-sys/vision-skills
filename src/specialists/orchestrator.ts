import { HttpSpecialistProvider, type SpecialistProvider } from './http.js';
import { SpecialistRegistry, SpecialistRouter } from './router.js';
import type {
  SpecialistCallMetric,
  SpecialistCapability,
  SpecialistRunResult,
  SpecialistsConfig,
} from './types.js';

interface PendingRoute {
  capability: SpecialistCapability;
  chain: string[];
  index: number;
  attempts: string[];
}

export class SpecialistOrchestrator {
  private readonly router: SpecialistRouter;
  private readonly providers = new Map<string, SpecialistProvider>();

  constructor(config: SpecialistsConfig, providers?: SpecialistProvider[]) {
    const registry = new SpecialistRegistry(config.providers);
    this.router = new SpecialistRouter(config, registry);
    for (const provider of providers ?? registry.list().map((item) => new HttpSpecialistProvider(item))) {
      this.providers.set(provider.id, provider);
    }
  }

  async run(
    image: Buffer,
    capabilitiesOrSignal?: ReadonlySet<SpecialistCapability> | AbortSignal,
    signal?: AbortSignal,
  ): Promise<SpecialistRunResult> {
    const capabilities = capabilitiesOrSignal instanceof AbortSignal ? undefined : capabilitiesOrSignal;
    signal = capabilitiesOrSignal instanceof AbortSignal ? capabilitiesOrSignal : signal;
    const routes = capabilities
      ? this.router.routes.filter((route) => capabilities.has(route.capability))
      : this.router.routes;
    const pending: PendingRoute[] = routes.map((route) => ({
      capability: route.capability, chain: route.providers, index: 0, attempts: [],
    }));
    const outputs: SpecialistRunResult['outputs'] = {};
    const selected = new Map<SpecialistCapability, string>();
    const metrics: SpecialistCallMetric[] = [];

    while (pending.some((item) => !outputs[item.capability] && item.index < item.chain.length)) {
      signal?.throwIfAborted();
      const groups = new Map<string, PendingRoute[]>();
      for (const item of pending) {
        if (outputs[item.capability] || item.index >= item.chain.length) continue;
        const providerId = item.chain[item.index]!;
        const group = groups.get(providerId) ?? [];
        group.push(item);
        groups.set(providerId, group);
      }
      await Promise.all([...groups].map(async ([providerId, items]) => {
        const provider = this.providers.get(providerId);
        if (!provider) {
          items.forEach((item) => { item.attempts.push(providerId); item.index += 1; });
          metrics.push({ provider: providerId, capabilities: items.map((item) => item.capability), latencyMs: 0, ok: false, error: `Provider '${providerId}' is unavailable` });
          return;
        }
        items.forEach((item) => item.attempts.push(providerId));
        const capabilities = items.map((item) => item.capability);
        const start = performance.now();
        try {
          const output = await provider.call(image, capabilities, signal);
          for (const item of items) { outputs[item.capability] = output; selected.set(item.capability, providerId); }
          metrics.push({ provider: providerId, capabilities, latencyMs: performance.now() - start, ok: true });
        } catch (error) {
          items.forEach((item) => { item.index += 1; });
          metrics.push({ provider: providerId, capabilities, latencyMs: performance.now() - start, ok: false, error: (error as Error).message });
        }
      }));
    }

    return {
      outputs,
      route: pending.map((item) => ({
        capability: item.capability,
        mode: this.router.route(item.capability)!.mode,
        configuredChain: item.chain,
        attempts: item.attempts,
        selectedProvider: selected.get(item.capability) ?? null,
        status: outputs[item.capability] ? 'succeeded' : 'failed',
        ...(!outputs[item.capability] ? {
          error: metrics.filter((metric) => metric.capabilities.includes(item.capability) && !metric.ok)
            .map((metric) => metric.error).filter(Boolean).join('; ') || 'All configured providers failed',
        } : {}),
      })),
      usage: {
        calls: metrics.length,
        latencyMs: metrics.reduce((sum, metric) => sum + metric.latencyMs, 0),
        byProvider: metrics.reduce<Record<string, number>>((counts, metric) => {
          counts[metric.provider] = (counts[metric.provider] ?? 0) + 1;
          return counts;
        }, {}),
        callMetrics: metrics,
      },
    };
  }
}
