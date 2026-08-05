import { createServer } from 'node:net';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AUTOSTART_FILE,
  clearPid,
  daemonDir,
  isHealthy,
  logFile,
  pidFile,
  processAlive,
  readPid,
  startDaemon,
  statusDaemon,
  stopDaemon,
  tailLog,
  windowsAutostartRegArgs,
  windowsAutostartRemoveArgs,
  windowsLauncherVbs,
  writePid,
} from '../src/daemon.js';

describe('daemon helpers', () => {
  it('writes and reads the pid file under the daemon dir', () => {
    const original = process.env.VISION_SKILLS_DAEMON_DIR;
    process.env.VISION_SKILLS_DAEMON_DIR = join(tmpdir(), `vs-daemon-test-${Date.now()}`);
    try {
      clearPid();
      expect(readPid()).toBeNull();
      writePid(424242);
      expect(readPid()).toBe(424242);
      expect(pidFile()).toContain(daemonDir());
      expect(logFile()).toContain(daemonDir());
      clearPid();
      expect(readPid()).toBeNull();
    } finally {
      if (original === undefined) delete process.env.VISION_SKILLS_DAEMON_DIR;
      else process.env.VISION_SKILLS_DAEMON_DIR = original;
    }
  });

  it('detects liveness of the current process', () => {
    expect(processAlive(process.pid)).toBe(true);
    expect(processAlive(2 ** 30)).toBe(false);
  });

  it('generates a hidden-window VBS launcher and registry commands', () => {
    const vbs = windowsLauncherVbs('C:\\Program Files\\nodejs\\node.exe', 'D:\\vs\\dist\\server\\start.js');
    expect(vbs).toContain('WScript.Shell').and.toContain('node.exe').and.toContain('start.js');
    expect(vbs).toContain(', 0, False');

    const add = windowsAutostartRegArgs('C:\\Users\\x\\.vision-skills\\vision-skills-daemon.vbs');
    expect(add[0]).toBe('add');
    expect(add.join(' ')).toContain(RunKey());
    expect(add.join(' ')).toContain('wscript.exe');
    expect(add.join(' ')).toContain(AUTOSTART_FILE);

    const remove = windowsAutostartRemoveArgs();
    expect(remove[0]).toBe('delete');
    expect(remove.join(' ')).toContain(RunKey());
  });

  it('tails the log file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vs-daemon-log-'));
    const original = process.env.VISION_SKILLS_DAEMON_DIR;
    process.env.VISION_SKILLS_DAEMON_DIR = dir;
    try {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(dir, 'daemon.log'), 'line1\nline2\nline3\n', 'utf8');
      const tail = tailLog(2);
      expect(tail).toEqual(['line2', 'line3']);
      expect(tailLog(0)).toEqual([]);
    } finally {
      if (original === undefined) delete process.env.VISION_SKILLS_DAEMON_DIR;
      else process.env.VISION_SKILLS_DAEMON_DIR = original;
    }
  });

  it('reports unhealthy for an unreachable port', async () => {
    expect(await isHealthy('127.0.0.1', 1)).toBe(false);
  });
});

describe('daemon lifecycle (real process)', () => {
  let dir: string;

  async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        server.close(() => resolve(port));
      });
      server.on('error', reject);
    });
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vs-daemon-e2e-'));
  });

  afterAll(async () => {
    await stopDaemon();
  });

  it('starts a server, reports status, then stops it', async () => {
    process.env.VISION_SKILLS_DAEMON_DIR = dir;
    const port = await freePort();
    const entry = join(dir, 'fixture-server.mjs');
    await writeFile(entry, [
      "import { createServer } from 'node:http';",
      'const port = Number(process.env.API_PORT ?? 8000);',
      'const server = createServer((req, res) => {',
      "  if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }",
      '  res.writeHead(404); res.end();',
      '});',
      'server.listen(port, process.env.API_HOST ?? \'127.0.0.1\', () => {',
      "  console.log('fixture listening');",
      '});',
      'process.once(\'SIGTERM\', () => server.close(() => process.exit(0)));',
    ].join('\n'), 'utf8');

    const started = await startDaemon({ entry, port });
    expect(started.pid).toBeGreaterThan(0);
    expect(readPid()).toBe(started.pid);
    expect((await statusDaemon(port)).running).toBe(true);
    expect((await statusDaemon(port)).healthy).toBe(true);

    const stopped = await stopDaemon();
    expect(stopped).toBe(true);
    expect(readPid()).toBeNull();
    expect((await statusDaemon(port)).running).toBe(false);
  });

  it('startDaemon errors when the entry is missing', async () => {
    process.env.VISION_SKILLS_DAEMON_DIR = dir;
    clearPid();
    await expect(startDaemon({ entry: join(dir, 'missing.mjs'), port: 8000 }))
      .rejects.toThrow(/not found/);
  });
});

function RunKey(): string {
  return 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
}
