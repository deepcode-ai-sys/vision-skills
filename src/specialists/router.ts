import { ConfigurationError } from '../core/errors.js';
import type {
  SpecialistCapability,
  SpecialistProviderConfig,
  SpecialistRouteConfig,
  SpecialistsConfig,
} from './types.js';

export interface ResolvedSpecialistRoute extends SpecialistRouteConfig {
  capability: SpecialistCapability;
}

export class SpecialistRegistry {
  private readonly providers = new Map<string, SpecialistProviderConfig>();
  constructor(configs: SpecialistProviderConfig[]) {
    for (const config of configs) {
      if (this.providers.has(config.id)) throw new ConfigurationError(`Duplicate specialist provider '${config.id}'`);
      this.providers.set(config.id, config);
    }
  }
  get(id: string): SpecialistProviderConfig | undefined { return this.providers.get(id); }
  list(): SpecialistProviderConfig[] { return [...this.providers.values()]; }
}

export class SpecialistRouter {
  readonly routes: ResolvedSpecialistRoute[];
  constructor(config: SpecialistsConfig, registry = new SpecialistRegistry(config.providers)) {
    this.routes = Object.entries(config.routes).map(([capability, route]) => {
      const typedCapability = capability as SpecialistCapability;
      for (const providerId of route.providers) {
        const provider = registry.get(providerId);
        if (!provider) throw new ConfigurationError(`Route '${capability}' references missing provider '${providerId}'`);
        if (!provider.capabilities.includes(typedCapability)) {
          throw new ConfigurationError(`Provider '${providerId}' does not declare capability '${capability}'`);
        }
      }
      return { capability: typedCapability, ...route };
    });
  }
  route(capability: SpecialistCapability): ResolvedSpecialistRoute | undefined {
    return this.routes.find((route) => route.capability === capability);
  }
}
