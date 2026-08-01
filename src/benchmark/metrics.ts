export interface BoxMetric {
  precision: number;
  recall: number;
  f1: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

export interface LabeledBox {
  category: string;
  bbox: number[];
}

function editDistance(expected: string[], actual: string[]): number {
  const previous = Array.from({ length: actual.length + 1 }, (_, index) => index);
  for (let row = 1; row <= expected.length; row++) {
    let diagonal = previous[0]!;
    previous[0] = row;
    for (let column = 1; column <= actual.length; column++) {
      const above = previous[column]!;
      previous[column] = expected[row - 1] === actual[column - 1]
        ? diagonal
        : 1 + Math.min(diagonal, above, previous[column - 1]!);
      diagonal = above;
    }
  }
  return previous[actual.length]!;
}

export function characterErrorRate(expected: string, actual: string): number {
  const expectedChars = [...expected];
  const distance = editDistance(expectedChars, [...actual]);
  return expectedChars.length === 0 ? (actual.length === 0 ? 0 : 1) : distance / expectedChars.length;
}

export function wordErrorRate(expected: string, actual: string): number {
  const words = (value: string): string[] => value.trim() ? value.trim().split(/\s+/u) : [];
  const expectedWords = words(expected);
  const distance = editDistance(expectedWords, words(actual));
  return expectedWords.length === 0 ? (actual.trim() === '' ? 0 : 1) : distance / expectedWords.length;
}

export function boxIou(a: number[], b: number[]): number {
  if (a.length !== 4 || b.length !== 4) return 0;
  const intersection = Math.max(0, Math.min(a[2]!, b[2]!) - Math.max(a[0]!, b[0]!))
    * Math.max(0, Math.min(a[3]!, b[3]!) - Math.max(a[1]!, b[1]!));
  const area = (box: number[]): number => Math.max(0, box[2]! - box[0]!) * Math.max(0, box[3]! - box[1]!);
  const union = area(a) + area(b) - intersection;
  return union > 0 ? intersection / union : 0;
}

export function boxPrecisionRecallF1(
  expected: number[][],
  actual: number[][],
  iouThreshold = 0.5,
): BoxMetric {
  const matches = new Array<number>(expected.length).fill(-1);
  const edges = actual.map((prediction) => expected
    .map((box, index) => ({ index, iou: boxIou(box, prediction) }))
    .filter(({ iou }) => iou >= iouThreshold)
    .sort((a, b) => b.iou - a.iou));
  const augment = (prediction: number, seen: Set<number>): boolean => {
    for (const { index } of edges[prediction]!) {
      if (seen.has(index)) continue;
      seen.add(index);
      if (matches[index] === -1 || augment(matches[index]!, seen)) {
        matches[index] = prediction;
        return true;
      }
    }
    return false;
  };
  const truePositives = actual.reduce(
    (count, _prediction, index) => count + (augment(index, new Set()) ? 1 : 0), 0,
  );
  const falsePositives = actual.length - truePositives;
  const falseNegatives = expected.length - truePositives;
  const precision = actual.length === 0 ? (expected.length === 0 ? 1 : 0) : truePositives / actual.length;
  const recall = expected.length === 0 ? (actual.length === 0 ? 1 : 0) : truePositives / expected.length;
  return {
    precision, recall,
    f1: precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall),
    truePositives, falsePositives, falseNegatives,
  };
}

export function labeledBoxPrecisionRecallF1(
  expected: LabeledBox[],
  actual: LabeledBox[],
  iouThreshold = 0.5,
): BoxMetric {
  const categories = new Set([...expected, ...actual].map(({ category }) => category));
  const totals = { truePositives: 0, falsePositives: 0, falseNegatives: 0 };
  for (const category of categories) {
    const metric = boxPrecisionRecallF1(
      expected.filter((box) => box.category === category).map((box) => box.bbox),
      actual.filter((box) => box.category === category).map((box) => box.bbox),
      iouThreshold,
    );
    totals.truePositives += metric.truePositives;
    totals.falsePositives += metric.falsePositives;
    totals.falseNegatives += metric.falseNegatives;
  }
  const predicted = totals.truePositives + totals.falsePositives;
  const expectedCount = totals.truePositives + totals.falseNegatives;
  const precision = predicted === 0 ? (expectedCount === 0 ? 1 : 0) : totals.truePositives / predicted;
  const recall = expectedCount === 0 ? (predicted === 0 ? 1 : 0) : totals.truePositives / expectedCount;
  return {
    ...totals,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall),
  };
}

export function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index]!;
}
