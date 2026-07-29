#!/usr/bin/env node
/**
 * Vision Skills CLI - analyze images from the command line.
 *
 * Usage:
 *   vision-skills analyze ./screenshot.png
 *   vision-skills analyze https://example.com/img.jpg
 *   cat img.png | vision-skills analyze
 *   vision-skills analyze ./img.jpg --mode advanced --json
 *   vision-skills serve          # start REST server
 *
 * Outputs structured JSON to stdout (machine-friendly, pipeable).
 */

import { VisionSkills } from './index.js';

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (cmd === 'serve') {
    const { createServer } = await import('./server/index.js');
    const app = await createServer();
    const port = Number(process.env.PORT ?? 8000);
    await app.listen({ port, host: '0.0.0.0' });
    return;
  }

  if (cmd !== 'analyze') {
    console.error('Usage:');
    console.error('  vision-skills analyze <image> [options]');
    console.error('  vision-skills analyze <image> --mode advanced');
    console.error('  vision-skills serve');
    console.error('  cat image.png | vision-skills analyze');
    process.exit(1);
  }

  const imageArg = args.find((a) => !a.startsWith('--')) || '-';
  const modeOpt = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'standard';
  const mode = (modeOpt === 'basic' || modeOpt === 'standard' || modeOpt === 'advanced' || modeOpt === 'full'
    ? modeOpt
    : 'standard') as 'basic' | 'standard' | 'advanced' | 'full';

  // Read image: from arg (path/URL) or stdin (pipe)
  let imageInput;
  if (imageArg === '-') {
    // stdin pipe
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    imageInput = Buffer.concat(chunks);
  } else {
    imageInput = imageArg;
  }

  const vision = new VisionSkills(); // config from env vars

  const result = await vision.analyze(imageInput, { mode });

  // Output JSON (full or compact)
  const json = args.includes('--json')
    ? JSON.stringify(result)
    : JSON.stringify(result, null, 2);
  process.stdout.write(json + '\n');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
