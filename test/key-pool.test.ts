import { describe, it, expect } from 'vitest';

import { GeminiKeyPool } from '../src/plugins/gemini/key-pool.js';

describe('GeminiKeyPool', () => {
  it('deduplicates keys', () => {
    const pool = new GeminiKeyPool(['a', 'b', 'a', '', '  ']);
    expect(pool.size).toBe(2);
  });

  it('rotates round-robin', () => {
    const pool = new GeminiKeyPool(['a', 'b', 'c']);
    const seen = [pool.next(), pool.next(), pool.next()];
    expect(new Set(seen)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('skips penalized keys', () => {
    const pool = new GeminiKeyPool(['a', 'b']);
    pool.penalize('a', 60_000);
    // Should only return b while a is cooling down
    expect(pool.next()).toBe('b');
    expect(pool.next()).toBe('b');
  });

  it('prefers rewarded (known-good) keys', () => {
    const pool = new GeminiKeyPool(['a', 'b', 'c']);
    pool.reward('c');
    expect(pool.next()).toBe('c');
    expect(pool.next()).toBe('c');
  });

  it('reward clears cooldown', () => {
    const pool = new GeminiKeyPool(['a', 'b']);
    pool.penalize('a', 60_000);
    pool.reward('a');
    expect(pool.next()).toBe('a');
  });

  it('penalize drops key from good list', () => {
    const pool = new GeminiKeyPool(['a', 'b']);
    pool.reward('a');
    pool.penalize('a', 60_000);
    expect(pool.next()).toBe('b');
  });

  it('availableCount reflects cooldowns', () => {
    const pool = new GeminiKeyPool(['a', 'b', 'c']);
    expect(pool.availableCount()).toBe(3);
    pool.penalize('a', 60_000);
    expect(pool.availableCount()).toBe(2);
  });

  it('returns soonest-to-recover when all cooling down', () => {
    const pool = new GeminiKeyPool(['a', 'b']);
    pool.penalize('a', 60_000);
    pool.penalize('b', 60_000);
    // Still returns something (best-effort) rather than null
    expect(pool.next()).not.toBeNull();
  });

  it('returns null for empty pool', () => {
    const pool = new GeminiKeyPool([]);
    expect(pool.next()).toBeNull();
    expect(pool.hasKeys).toBe(false);
  });
});
