export interface BoundedOutput {
  data?: unknown;
  json?: string;
  truncation: {
    truncated: boolean;
    originalChars: number;
    returnedChars: number;
    maxChars: number;
  };
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? 'null';
}

function lengthOf(value: unknown, path: readonly string[]): number {
  let node: unknown = value;
  for (const key of path) node = (node as Record<string, unknown>)[key];
  return Array.isArray(node) ? node.length : 0;
}

function setSliceAtPath(value: unknown, path: readonly string[], keep: number): unknown {
  const clone = structuredClone(value);
  let node: Record<string, unknown> = clone as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    node = node[path[i]!] as Record<string, unknown>;
  }
  const array = node[path[path.length - 1]!] as unknown[];
  node[path[path.length - 1]!] = array.slice(0, keep);
  return clone;
}

/** Largest keep-count (elements to preserve from an array) that still fits maxChars, or null if nothing fits / no cut needed. */
function bestKeep(value: unknown, path: readonly string[], maxChars: number): number | null {
  const length = lengthOf(value, path);
  if (length === 0) return null;
  if (prettyJson(setSliceAtPath(value, path, length)).length <= maxChars) return null;
  let lo = 0;
  let hi = length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (prettyJson(setSliceAtPath(value, path, mid)).length <= maxChars) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? best : null;
}

export function boundOutput(value: unknown, maxChars: number): BoundedOutput {
  if (!Number.isSafeInteger(maxChars) || maxChars < 0) {
    throw new RangeError('maxChars must be a non-negative safe integer');
  }
  const full = prettyJson(value);
  if (full.length <= maxChars) {
    return {
      data: value === undefined ? null : value,
      truncation: { truncated: false, originalChars: full.length, returnedChars: full.length, maxChars },
    };
  }

  // Prefer truncating at element boundaries so the returned JSON stays valid:
  // trim the largest arrays (entities, edges, ...) first, keeping a valid prefix.
  if (value !== null && typeof value === 'object') {
    const arrays: string[][] = [];
    const walk = (node: unknown, path: string[]): void => {
      if (Array.isArray(node)) {
        if (node.length > 0) arrays.push(path);
        return;
      }
      if (node && typeof node === 'object') {
        for (const [key, nested] of Object.entries(node as Record<string, unknown>)) {
          walk(nested, [...path, key]);
        }
      }
    };
    walk(value, []);
    arrays.sort((a, b) => lengthOf(value, b) - lengthOf(value, a));
    for (const path of arrays) {
      const keep = bestKeep(value, path, maxChars);
      if (keep !== null && keep < lengthOf(value, path)) {
        const data = setSliceAtPath(value, path, keep);
        return {
          data,
          truncation: {
            truncated: true,
            originalChars: full.length,
            returnedChars: prettyJson(data).length,
            maxChars,
          },
        };
      }
    }
  }

  const suffix = '\n... [truncated]';
  const returned = maxChars <= suffix.length
    ? suffix.slice(0, maxChars)
    : full.slice(0, maxChars - suffix.length) + suffix;
  return {
    json: returned,
    truncation: { truncated: true, originalChars: full.length, returnedChars: returned.length, maxChars },
  };
}

export function boundedLegacyText(output: BoundedOutput): string {
  return output.data === undefined ? output.json ?? '' : JSON.stringify(output.data, null, 2);
}
