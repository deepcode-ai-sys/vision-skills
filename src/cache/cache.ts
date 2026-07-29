/**
 * Caching layer.
 *
 * In-memory TTL cache by default (works without external dependencies).
 * Implement CacheBackend for Redis in production. Caches full pipeline
 * responses keyed by image hash + mode + options.
 */

export interface CacheBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<number>;
}

export class InMemoryCacheBackend implements CacheBackend {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<number> {
    const count = this.store.size;
    this.store.clear();
    return count;
  }
}

export class CacheManager {
  private hits = 0;
  private misses = 0;

  constructor(
    private backend: CacheBackend = new InMemoryCacheBackend(),
    public enabled = true,
    private ttlSeconds = 3600,
    private piiTtlSeconds = 300,
  ) {}

  static makeKey(imageHash: string, mode: string, options: Record<string, unknown> = {}): string {
    const opts = JSON.stringify(options, Object.keys(options).sort());
    return `vision:${mode}:${imageHash}:${opts}`;
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.enabled) return null;
    const raw = await this.backend.get(key);
    if (raw === null) {
      this.misses += 1;
      return null;
    }
    this.hits += 1;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, piiFlagged = false): Promise<void> {
    if (!this.enabled) return;
    const ttl = piiFlagged ? this.piiTtlSeconds : this.ttlSeconds;
    await this.backend.set(key, JSON.stringify(value), ttl);
  }

  async clear(): Promise<number> {
    return this.backend.clear();
  }

  get hitRate(): number {
    const total = this.hits + this.misses;
    return total > 0 ? this.hits / total : 0;
  }

  stats(): { enabled: boolean; hits: number; misses: number; hitRate: number } {
    return {
      enabled: this.enabled,
      hits: this.hits,
      misses: this.misses,
      hitRate: Math.round(this.hitRate * 1000) / 1000,
    };
  }
}
