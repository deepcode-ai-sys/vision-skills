import { describe, expect, it } from 'vitest';

import {
  boxIou, boxPrecisionRecallF1, characterErrorRate, labeledBoxPrecisionRecallF1,
  percentile, wordErrorRate,
} from '../src/benchmark/metrics.js';

describe('benchmark metrics', () => {
  it('handles exact, empty, unicode, and insertion OCR cases', () => {
    expect(characterErrorRate('', '')).toBe(0);
    expect(characterErrorRate('', 'x')).toBe(1);
    expect(characterErrorRate('cafe', 'cafes')).toBe(0.25);
    expect(characterErrorRate('xin chào', 'xin chào')).toBe(0);
    expect(wordErrorRate('one two', 'one too')).toBe(0.5);
    expect(wordErrorRate('', 'word')).toBe(1);
  });

  it('computes IoU and one-to-one box matching edge cases', () => {
    expect(boxIou([0, 0, 10, 10], [5, 5, 15, 15])).toBeCloseTo(25 / 175);
    expect(boxIou([0, 0, 0, 0], [0, 0, 0, 0])).toBe(0);
    expect(boxPrecisionRecallF1([], [])).toMatchObject({ precision: 1, recall: 1, f1: 1 });
    expect(boxPrecisionRecallF1([[0, 0, 10, 10]], [[0, 0, 10, 10], [0, 0, 10, 10]])).toMatchObject({
      truePositives: 1, falsePositives: 1, falseNegatives: 0, precision: 0.5, recall: 1,
    });
  });

  it('finds a maximum-cardinality assignment when greedy matching loses a box', () => {
    const expected = [[0, 0, 10, 10], [4, 0, 14, 10]];
    const actual = [[2, 0, 12, 10], [0, 0, 10, 10]];
    expect(boxPrecisionRecallF1(expected, actual, 0.5)).toMatchObject({
      truePositives: 2, falsePositives: 0, falseNegatives: 0, f1: 1,
    });
  });

  it('does not match geometrically identical boxes across categories', () => {
    const box = [0, 0, 10, 10];
    expect(labeledBoxPrecisionRecallF1(
      [{ category: 'ocr', bbox: box }, { category: 'ui', bbox: [20, 20, 30, 30] }],
      [{ category: 'ui', bbox: box }, { category: 'ocr', bbox: [20, 20, 30, 30] }],
    )).toEqual({
      truePositives: 0, falsePositives: 2, falseNegatives: 2,
      precision: 0, recall: 0, f1: 0,
    });
  });

  it('uses nearest-rank percentiles and returns null for no samples', () => {
    expect(percentile([], 0.95)).toBeNull();
    expect(percentile([4, 1, 3, 2], 0.5)).toBe(2);
    expect(percentile([4, 1, 3, 2], 0.95)).toBe(4);
  });
});
