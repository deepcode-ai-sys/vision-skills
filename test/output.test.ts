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
});
