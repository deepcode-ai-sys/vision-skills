/**
 * Smoke test: run a REAL image through Gemini to verify end-to-end.
 * NOT part of the CI suite. Requires a live API key + a prior `npm run build`.
 *
 * Usage: node scripts/smoke.mjs <api-key>
 * (key is passed as an arg so it never lives in code or git)
 */

import sharp from 'sharp';
import { VisionSkills } from '../dist/index.js';

async function makeTextImage() {
  const svg = `
    <svg width="600" height="400" xmlns="http://www.w3.org/2000/svg">
      <rect width="600" height="400" fill="#ffffff"/>
      <text x="40" y="80" font-family="Arial" font-size="40" fill="#000000">Xin chao Vision Skills</text>
      <text x="40" y="140" font-family="Arial" font-size="28" fill="#333333">Login</text>
      <rect x="40" y="180" width="200" height="50" fill="#4a90d9"/>
      <text x="70" y="213" font-family="Arial" font-size="24" fill="#ffffff">Sign In</text>
      <circle cx="480" cy="300" r="60" fill="#e74c3c"/>
    </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  const apiKey = process.argv[2];
  if (!apiKey) {
    console.error('Usage: node scripts/smoke.mjs <api-key>');
    process.exit(1);
  }

  const image = await makeTextImage();
  const vision = new VisionSkills({ geminiApiKey: apiKey, cacheEnabled: false });

  console.log('=== Provider health ===');
  console.log(await vision.healthCheck());

  for (const mode of ['basic', 'standard']) {
    console.log(`\n=== analyze(mode=${mode}) ===`);
    const start = Date.now();
    const result = await vision.analyze(image, { mode });
    console.log(`latency: ${Date.now() - start}ms (reported ${result.latencyMsTotal}ms)`);
    console.log(`imageType: ${result.imageType}, modeUsed: ${result.modeUsed}`);
    console.log(`entities: ${result.entities.length}`);
    for (const e of result.entities) {
      const t = e.text ? ` text="${e.text}"` : '';
      console.log(`  - ${e.entityId} [${e.label}] bbox=${JSON.stringify(e.bbox.toList())}${t}`);
    }
    console.log(`spatial edges: ${result.sceneGraph.spatial.length}`);
    if (result.errors.length) console.log('errors:', result.errors);
    for (const p of result.providerResults) {
      console.log(`  provider ${p.plugin}: errors=${p.errors.length} latency=${Math.round(p.latencyMs)}ms`);
    }
  }
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e);
  process.exit(1);
});
