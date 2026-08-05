import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { VisionSkills, characterErrorRate, labeledBoxPrecisionRecallF1, percentile, wordErrorRate } from '../dist/index.js';

const root = dirname(fileURLToPath(import.meta.url));
const profile = process.argv[2] ?? 'mock';
if (profile !== 'mock') throw new Error(`Unknown benchmark profile '${profile}'. Only the deterministic mock pipeline is included.`);

const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const cases = [];
for (const item of manifest.cases) {
  const expected = JSON.parse(await readFile(join(root, item.expected), 'utf8'));
  const fixture = JSON.parse(await readFile(join(root, item.fixture), 'utf8'));
  const image = await sharp({ create: {
    width: fixture.width, height: fixture.height, channels: 3,
    background: { r: fixture.seed, g: 32, b: 64 },
  } }).png().toBuffer();
  const vision = new VisionSkills({ useMockProviders: true, cacheEnabled: false });
  const started = performance.now();
  const response = await vision.analyze(image, { mode: 'standard', enableReasoner: false });
  const latencyMs = performance.now() - started;
  const actual = {
    text: response.entities.filter((entity) => entity.label === 'text_block').map((entity) => ({ text: entity.text, bbox: entity.bbox.toList() })),
    objects: response.entities.filter((entity) => entity.label === 'person' || entity.label === 'vehicle.bicycle').map((entity) => ({ label: entity.label, bbox: entity.bbox.toList() })),
    ui: response.entities.filter((entity) => entity.label === 'ui.button').map((entity) => ({ label: entity.label, text: entity.text, bbox: entity.bbox.toList() })),
  };
  const expectedText = expected.text.map((block) => block.text).join(' ');
  const actualText = actual.text.map((block) => block.text).join(' ');
  const labeledBoxes = (result) => [
    ...result.text.map((entry) => ({ category: 'ocr', bbox: entry.bbox })),
    ...result.objects.map((entry) => ({ category: 'object', bbox: entry.bbox })),
    ...result.ui.map((entry) => ({ category: 'ui', bbox: entry.bbox })),
  ];
  cases.push({
    id: item.id,
    cer: characterErrorRate(expectedText, actualText),
    wer: wordErrorRate(expectedText, actualText),
    boxes: labeledBoxPrecisionRecallF1(labeledBoxes(expected), labeledBoxes(actual)),
    calls: 1,
    latencyMs,
  });
}
const result = {
  profile, cases,
  aggregate: {
    cer: cases.reduce((sum, item) => sum + item.cer, 0) / cases.length,
    wer: cases.reduce((sum, item) => sum + item.wer, 0) / cases.length,
    boxPrecision: cases.reduce((sum, item) => sum + item.boxes.precision, 0) / cases.length,
    boxRecall: cases.reduce((sum, item) => sum + item.boxes.recall, 0) / cases.length,
    boxF1: cases.reduce((sum, item) => sum + item.boxes.f1, 0) / cases.length,
    calls: cases.reduce((sum, item) => sum + item.calls, 0),
    latencyP50Ms: percentile(cases.map((item) => item.latencyMs), 0.5),
    latencyP95Ms: percentile(cases.map((item) => item.latencyMs), 0.95),
  },
};
await mkdir(join(root, 'results'), { recursive: true });
await writeFile(join(root, 'results', `${profile}.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
