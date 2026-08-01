import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { VisionSkills, characterErrorRate, labeledBoxPrecisionRecallF1, percentile, wordErrorRate } from '../dist/index.js';

const root = dirname(fileURLToPath(import.meta.url));
const profile = process.argv[2] ?? 'mock';
if (profile !== 'mock') throw new Error(`Unknown benchmark profile '${profile}'. Only the deterministic mock pipeline is included.`);

function deterministicProviderOutput(fixture) {
  if (fixture.seed !== 17) throw new Error(`Unknown generated fixture seed ${fixture.seed}`);
  const { width, height } = fixture;
  return {
    protocol: 'canonical-v1',
    text: [{ text: 'Login', bbox: [width / 8, height / 8, width * 17 / 32, height / 3], confidence: null }],
    objects: [{ label: 'panel', bbox: [width / 16, height / 16, width * 15 / 16, height * 11 / 12], confidence: 0.9 }],
    ui: [{ label: 'button', text: 'Submit', bbox: [width * 3 / 16, height * 7 / 12, width * 3 / 4, height * 5 / 6], confidence: null, clickable: true }],
    tables: [], regions: [], layout: null, code: null,
  };
}

const providerCalls = [];
let providerFixture;
const provider = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    providerCalls.push({ url: request.url, capabilities: body.capabilities, imageBytes: Buffer.from(body.image, 'base64').length });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(deterministicProviderOutput(providerFixture)));
  });
});
await new Promise((resolve, reject) => {
  provider.once('error', reject);
  provider.listen(0, '127.0.0.1', resolve);
});

try {
  const address = provider.address();
  if (!address || typeof address === 'string') throw new Error('Mock provider did not bind a TCP port');
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  const cases = [];
  for (const item of manifest.cases) {
    const expected = JSON.parse(await readFile(join(root, item.expected), 'utf8'));
    providerFixture = JSON.parse(await readFile(join(root, item.fixture), 'utf8'));
    const callsBefore = providerCalls.length;
    const image = await sharp({ create: {
      width: providerFixture.width, height: providerFixture.height, channels: 3,
      background: { r: providerFixture.seed, g: 32, b: 64 },
    } }).png().toBuffer();
    const capabilities = item.capabilities;
    const vision = new VisionSkills({
      useMockProviders: true,
      cacheEnabled: false,
      specialists: {
        providers: [{ id: 'benchmark-http', protocol: 'canonical-v1', endpoint: `http://127.0.0.1:${address.port}/analyze`, capabilities }],
        routes: Object.fromEntries(capabilities.map((capability) => [capability, { providers: ['benchmark-http'], mode: 'replace' }])),
      },
    });
    const started = performance.now();
    const response = await vision.analyze(image, { mode: 'standard', enableReasoner: false });
    const latencyMs = performance.now() - started;
    const actual = {
      text: response.entities.filter((entity) => entity.label === 'text_block').map((entity) => ({ text: entity.text, bbox: entity.bbox.toList() })),
      objects: response.entities.filter((entity) => entity.label === 'panel').map((entity) => ({ label: entity.label, bbox: entity.bbox.toList() })),
      ui: response.entities.filter((entity) => entity.label === 'button').map((entity) => ({ label: entity.label, text: entity.text, bbox: entity.bbox.toList() })),
    };
    const calls = providerCalls.length - callsBefore;
    const expectedText = expected.text.map((block) => block.text).join(' ');
    const actualText = actual.text.map((block) => block.text).join(' ');
    const labeledBoxes = (result) => [
      ...result.text.map((entry) => ({ category: 'ocr', bbox: entry.bbox })),
      ...result.objects.map((entry) => ({ category: 'object', bbox: entry.bbox })),
      ...result.ui.map((entry) => ({ category: 'ui', bbox: entry.bbox })),
    ];
    const routed = response.route ?? [];
    const routingAccuracy = capabilities.filter((capability) => routed.some((route) =>
      route.capability === capability && route.selectedProvider === 'benchmark-http' && route.status === 'succeeded')).length / capabilities.length;
    cases.push({
      id: item.id,
      cer: characterErrorRate(expectedText, actualText),
      wer: wordErrorRate(expectedText, actualText),
      boxes: labeledBoxPrecisionRecallF1(labeledBoxes(expected), labeledBoxes(actual)),
      routingAccuracy,
      calls,
      providerCalls: providerCalls.slice(callsBefore),
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
      routingAccuracy: cases.reduce((sum, item) => sum + item.routingAccuracy, 0) / cases.length,
      calls: cases.reduce((sum, item) => sum + item.calls, 0),
      latencyP50Ms: percentile(cases.map((item) => item.latencyMs), 0.5),
      latencyP95Ms: percentile(cases.map((item) => item.latencyMs), 0.95),
    },
  };
  await mkdir(join(root, 'results'), { recursive: true });
  await writeFile(join(root, 'results', `${profile}.json`), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} finally {
  await new Promise((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()));
}
