/**
 * Continuous smoke test with multi-key rotation.
 *
 * Loads ALL keys from a file into the pool and runs the real image through
 * the pipeline repeatedly, so key rotation kicks in when individual keys hit
 * 429. Proves the system reads images smoothly despite free-tier limits.
 *
 * Usage: node scripts/smoke-loop.mjs <keys-file> <image-path> [mode] [runs]
 */

import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { VisionSkills } from '../dist/index.js';

async function main() {
  const keysFile = process.argv[2];
  const imgPath = process.argv[3];
  const mode = process.argv[4] || 'standard';
  const runs = Number(process.argv[5] || 5);

  if (!keysFile || !imgPath) {
    console.error('Usage: node scripts/smoke-loop.mjs <keys-file> <image-path> [mode] [runs]');
    process.exit(1);
  }

  const keys = readFileSync(keysFile, 'utf8')
    .split('\n')
    .map((k) => k.trim())
    .filter(Boolean);
  console.log(`Loaded ${keys.length} keys into pool.`);

  const image = await sharp(imgPath).png().toBuffer();
  console.log(`Image: ${imgPath}`);

  // Fresh instance so cache doesn't short-circuit (we WANT real calls).
  const vision = new VisionSkills({ geminiApiKeys: keys, cacheEnabled: false });

  let ok = 0;
  let partial = 0;
  let failed = 0;

  for (let i = 1; i <= runs; i++) {
    const start = Date.now();
    try {
      const r = await vision.analyze(image, { mode });
      const geminiErrors = r.providerResults
        .filter((p) => p.provider === 'gemini')
        .reduce((s, p) => s + p.errors.length, 0);
      const textCount = r.entities.filter((e) => e.text).length;
      const objCount = r.entities.filter((e) => !e.text && e.label !== 'layout_region' && !e.elementType).length;

      const status = geminiErrors === 0 ? 'OK' : 'PARTIAL(gemini errored)';
      if (geminiErrors === 0) ok++;
      else partial++;

      console.log(
        `run ${i}/${runs} [${status}] ${Date.now() - start}ms | type=${r.imageType} ` +
          `entities=${r.entities.length} text=${textCount} obj=${objCount} ` +
          `spatial=${r.sceneGraph.spatial.length}`,
      );
    } catch (e) {
      failed++;
      console.log(`run ${i}/${runs} [FAILED] ${Date.now() - start}ms: ${e.message}`);
    }
  }

  console.log(`\nSummary: OK=${ok} PARTIAL=${partial} FAILED=${failed} of ${runs}`);
}

main().catch((e) => {
  console.error('LOOP FAILED:', e);
  process.exit(1);
});
