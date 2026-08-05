/**
 * Renders benchmark/results/mock.json into benchmark/benchmark-chart.svg.
 *
 * The SVG is a dependency-free static visualization committed for the README.
 * Run `npm run chart:benchmark` after `npm run benchmark:mock` to refresh it.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const result = JSON.parse(await readFile(join(root, 'benchmark', 'results', 'mock.json'), 'utf8'));

const WIDTH = 760;
const HEIGHT = 360;
const MARGIN_LEFT = 24;
const MARGIN_TOP = 64;
const BAR_HEIGHT = 26;
const BAR_GAP = 44;
const BAR_MAX_WIDTH = 270;
const COLUMN_GAP = 32;
const COLUMN_WIDTH = (WIDTH - MARGIN_LEFT * 2 - COLUMN_GAP) / 2;

const FONT = "'Segoe UI', system-ui, -apple-system, sans-serif";
const MONO = "'Cascadia Mono', 'Consolas', monospace";
const INK = '#1f2937';
const MUTED = '#6b7280';
const GRID = '#e5e7eb';
const BLUE = '#2563eb';
const GREEN = '#059669';
const AMBER = '#d97706';

function escape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function bar(x, y, label, valueText, fraction, color) {
  const track = BAR_MAX_WIDTH;
  const filled = Math.max(2, Math.round(track * fraction));
  return [
    `<text x="${x}" y="${y + 17}" font-family="${FONT}" font-size="12.5" fill="${INK}">${escape(label)}</text>`,
    `<rect x="${x}" y="${y + 26}" width="${track}" height="${BAR_HEIGHT}" rx="5" fill="${GRID}"/>`,
    `<rect x="${x}" y="${y + 26}" width="${filled}" height="${BAR_HEIGHT}" rx="5" fill="${color}"/>`,
    `<text x="${x + track + 10}" y="${y + 45}" font-family="${MONO}" font-size="12.5" font-weight="600" fill="${INK}">${escape(valueText)}</text>`,
  ].join('');
}

function panelTitle(x, text) {
  return `<text x="${x}" y="${MARGIN_TOP - 30}" font-family="${FONT}" font-size="15" font-weight="700" fill="${INK}">${escape(text)}</text>`;
}

const aggregate = result.aggregate;
const accuracy = [
  bar(MARGIN_LEFT, MARGIN_TOP + 0, 'Character error rate (CER)', `${(aggregate.cer * 100).toFixed(1)}%`, 1 - aggregate.cer, GREEN),
  bar(MARGIN_LEFT, MARGIN_TOP + BAR_GAP, 'Word error rate (WER)', `${(aggregate.wer * 100).toFixed(1)}%`, 1 - aggregate.wer, GREEN),
  bar(MARGIN_LEFT, MARGIN_TOP + BAR_GAP * 2, 'Box precision / recall / F1', `${aggregate.boxF1.toFixed(2)} F1`, aggregate.boxF1, BLUE),
];

const latencyMax = Math.max(aggregate.latencyP50Ms ?? 0, aggregate.latencyP95Ms ?? 0, 1);
const latencyX = MARGIN_LEFT + COLUMN_WIDTH + COLUMN_GAP;
const latency = [
  bar(latencyX, MARGIN_TOP + 0, 'Latency p50', `${(aggregate.latencyP50Ms ?? 0).toFixed(1)} ms`, (aggregate.latencyP50Ms ?? 0) / latencyMax, AMBER),
  bar(latencyX, MARGIN_TOP + BAR_GAP, 'Latency p95', `${(aggregate.latencyP95Ms ?? 0).toFixed(1)} ms`, (aggregate.latencyP95Ms ?? 0) / latencyMax, AMBER),
  bar(latencyX, MARGIN_TOP + BAR_GAP * 2, `Cases / provider calls`, `${aggregate.calls}`, 1, BLUE),
];

const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Vision Skills mock benchmark: perfect accuracy and local pipeline latency">`,
  `<rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>`,
  `<text x="${MARGIN_LEFT}" y="30" font-family="${FONT}" font-size="19" font-weight="700" fill="${INK}">Vision Skills — deterministic mock benchmark</text>`,
  `<text x="${MARGIN_LEFT}" y="48" font-family="${FONT}" font-size="11.5" fill="${MUTED}">profile: mock · case: ${result.cases.map((c) => c.id).join(', ')}</text>`,
  panelTitle(MARGIN_LEFT, 'Output accuracy'),
  panelTitle(latencyX, 'Pipeline latency'),
  ...accuracy,
  ...latency,
  `<line x1="${MARGIN_LEFT}" y1="${HEIGHT - 46}" x2="${WIDTH - MARGIN_LEFT}" y2="${HEIGHT - 46}" stroke="${GRID}"/>`,
  `<text x="${MARGIN_LEFT}" y="${HEIGHT - 28}" font-family="${FONT}" font-size="11" fill="${MUTED}">Mock providers are deterministic; these values validate plumbing only, not Gemini or real-image accuracy.</text>`,
  `</svg>`,
].join('\n');

await writeFile(join(root, 'benchmark', 'benchmark-chart.svg'), svg);
console.log(`Wrote benchmark/benchmark-chart.svg (${result.cases.length} case${result.cases.length === 1 ? '' : 's'})`);
