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
import {
  installAutostart,
  startDaemon,
  statusDaemon,
  stopDaemon,
  tailLog,
  uninstallAutostart,
} from './daemon.js';

async function daemonCommand(args: string[]): Promise<number> {
  const [sub, ...rest] = args;

  if (sub === 'start') {
    const portArg = rest.indexOf('--port');
    const port = portArg >= 0 ? Number(rest[portArg + 1]) : undefined;
    const started = await startDaemon(port === undefined ? {} : { port });
    console.log(`Vision Skills daemon started (PID ${started.pid}) on http://${started.host}:${started.port}`);
    console.log('Logs:');
    for (const line of tailLog(8)) console.log(`  ${line}`);
    return 0;
  }

  if (sub === 'stop') {
    const stopped = await stopDaemon();
    console.log(stopped ? 'Vision Skills daemon stopped.' : 'No running Vision Skills daemon was found.');
    return 0;
  }

  if (sub === 'status' || sub === undefined) {
    const status = await statusDaemon();
    console.log(status.running
      ? `Vision Skills daemon is RUNNING (PID ${status.pid}); health: ${status.healthy ? 'ok' : 'unreachable'}`
      : 'Vision Skills daemon is not running.');
    if (status.log.length) {
      console.log('Recent log:');
      for (const line of status.log) console.log(`  ${line}`);
    }
    return status.running && !status.healthy ? 1 : 0;
  }

  if (sub === 'autostart') {
    const [action] = rest;
    if (action === 'enable' || action === 'on') {
      const file = await installAutostart();
      console.log(`Autostart enabled: launches the daemon at login (${file}).`);
      console.log('Run "vision-skills daemon start" once now, or the daemon will start on next login.');
      return 0;
    }
    if (action === 'disable' || action === 'off') {
      await uninstallAutostart();
      console.log('Autostart disabled. A running daemon continues until stopped.');
      return 0;
    }
    console.error('Usage: vision-skills daemon autostart enable|disable');
    return 1;
  }

  console.error('Usage:');
  console.error('  vision-skills daemon start [--port 8000]');
  console.error('  vision-skills daemon stop');
  console.error('  vision-skills daemon status');
  console.error('  vision-skills daemon autostart enable|disable');
  return 1;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (cmd === 'daemon') {
    process.exitCode = await daemonCommand(args);
    return;
  }

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
    console.error('  vision-skills daemon start|stop|status|autostart');
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
