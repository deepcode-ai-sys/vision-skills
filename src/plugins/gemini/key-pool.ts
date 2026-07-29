/**
 * Gemini API key pool with rotation.
 *
 * Free-tier Gemini keys hit 429 quickly. This pool holds many keys and
 * rotates to the next available one when a key is rate-limited, putting the
 * limited key into a short cooldown before it's tried again.
 *
 * Thread-safety: single-threaded Node event loop, so a plain object is fine.
 */

export interface KeyPoolOptions {
  /** How long (ms) to cool down a key after a 429. Default 60s. */
  cooldownMs?: number;
}

export class GeminiKeyPool {
  private keys: string[];
  private cooldownUntil: Map<string, number> = new Map();
  /** Keys that succeeded recently, tried first (most-recent first). */
  private goodKeys: string[] = [];
  private cursor = 0;
  private cooldownMs: number;

  constructor(keys: string[], options: KeyPoolOptions = {}) {
    // De-duplicate while preserving order.
    this.keys = [...new Set(keys.filter((k) => k && k.trim().length > 0))];
    this.cooldownMs = options.cooldownMs ?? 60_000;
  }

  get size(): number {
    return this.keys.length;
  }

  get hasKeys(): boolean {
    return this.keys.length > 0;
  }

  /**
   * Return the next key to try. Preference order:
   * 1. Recently-successful keys that are not cooling down (avoids wasting
   *    time on keys that hang or 429).
   * 2. Round-robin over the rest, skipping cooled-down keys.
   * 3. If everything is cooling down, the soonest-to-recover key.
   */
  next(): string | null {
    if (this.keys.length === 0) return null;
    const now = Date.now();

    // 1. Prefer a known-good key that is available.
    for (const key of this.goodKeys) {
      if ((this.cooldownUntil.get(key) ?? 0) <= now) {
        return key;
      }
    }

    // 2. Round-robin over remaining available keys.
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.cursor + i) % this.keys.length;
      const key = this.keys[idx]!;
      if ((this.cooldownUntil.get(key) ?? 0) <= now) {
        this.cursor = (idx + 1) % this.keys.length;
        return key;
      }
    }

    // 3. All cooling down → soonest-to-recover.
    let best: string | null = null;
    let bestUntil = Infinity;
    for (const key of this.keys) {
      const until = this.cooldownUntil.get(key) ?? 0;
      if (until < bestUntil) {
        bestUntil = until;
        best = key;
      }
    }
    return best;
  }

  /** Mark a key as rate-limited; it will be skipped until cooldown expires. */
  penalize(key: string, retryAfterMs?: number): void {
    const cooldown = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : this.cooldownMs;
    this.cooldownUntil.set(key, Date.now() + cooldown);
    // Drop from good list if it was there.
    this.goodKeys = this.goodKeys.filter((k) => k !== key);
  }

  /** Mark a key as successful so it's preferred next time. */
  reward(key: string): void {
    this.cooldownUntil.delete(key);
    // Move to front of the good list (most-recent-success first).
    this.goodKeys = [key, ...this.goodKeys.filter((k) => k !== key)].slice(0, 8);
  }

  /** Number of keys currently available (not cooling down). */
  availableCount(): number {
    const now = Date.now();
    return this.keys.filter((k) => (this.cooldownUntil.get(k) ?? 0) <= now).length;
  }
}
