import { describe, expect, it } from 'vitest';

import { boundOutput, boundedLegacyText } from '../src/utils/output.js';

describe('bounded output', () => {
  it('never returns text longer than maxChars, including limits shorter than the suffix', () => {
    for (let maxChars = 0; maxChars <= 20; maxChars += 1) {
      const output = boundOutput({ value: 'x'.repeat(100) }, maxChars);
      expect(output.truncation.returnedChars).toBeLessThanOrEqual(maxChars);
      expect(boundedLegacyText(output).length).toBeLessThanOrEqual(maxChars);
    }
    expect(boundOutput(undefined, 4)).toMatchObject({ data: null, truncation: { returnedChars: 4 } });
    expect(boundedLegacyText(boundOutput(undefined, 4))).toBe('null');
  });

  it('rejects invalid bounds', () => {
    for (const value of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => boundOutput('x', value)).toThrow(/non-negative safe integer/);
    }
  });

  it('truncates at array element boundaries, keeping valid JSON', () => {
    const value = { entities: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }], warnings: [] };
    const output = boundOutput(value, 120);
    expect(output.truncation.truncated).toBe(true);
    expect(output.data).toBeDefined();
    expect(JSON.parse(JSON.stringify(output.data))).toBeDefined();
    const parsed = JSON.parse(JSON.stringify(output.data)) as { entities: Array<{ id: number }> };
    expect(parsed.entities.length).toBeLessThan(3);
    expect(parsed.entities.every((entity) => entity.id && typeof entity.id === 'number')).toBe(true);
    expect(JSON.stringify(output.data, null, 2).length).toBeLessThanOrEqual(120);
  });

  it('trims the largest array first when multiple arrays overflow', () => {
    const value = {
      edges: Array.from({ length: 20 }, (_, i) => ({ from: `a${i}`, to: `b${i}` })),
      entities: Array.from({ length: 5 }, (_, i) => ({ id: i })),
    };
    const output = boundOutput(value, 300);
    expect(output.data).toBeDefined();
    const parsed = JSON.parse(JSON.stringify(output.data)) as { edges: unknown[]; entities: unknown[] };
    expect(parsed.entities.length).toBe(5);
    expect(parsed.edges.length).toBeLessThan(20);
  });

  it('falls back to a hard slice for scalars and objects without arrays', () => {
    expect(boundOutput('x'.repeat(50), 30).json).toContain('truncated');
    expect(boundOutput({ single: 'y'.repeat(50) }, 20).data).toBeUndefined();
    expect(boundOutput({ single: 'y'.repeat(50) }, 20).json).toBeDefined();
  });
});
