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

export function boundOutput(value: unknown, maxChars: number): BoundedOutput {
  if (!Number.isSafeInteger(maxChars) || maxChars < 0) {
    throw new RangeError('maxChars must be a non-negative safe integer');
  }
  const json = JSON.stringify(value, null, 2) ?? 'null';
  if (json.length <= maxChars) {
    return {
      data: value === undefined ? null : value,
      truncation: { truncated: false, originalChars: json.length, returnedChars: json.length, maxChars },
    };
  }
  const suffix = '\n... [truncated]';
  const returned = maxChars <= suffix.length
    ? suffix.slice(0, maxChars)
    : json.slice(0, maxChars - suffix.length) + suffix;
  return {
    json: returned,
    truncation: { truncated: true, originalChars: json.length, returnedChars: returned.length, maxChars },
  };
}

export function boundedLegacyText(output: BoundedOutput): string {
  return output.data === undefined ? output.json ?? '' : JSON.stringify(output.data, null, 2);
}
