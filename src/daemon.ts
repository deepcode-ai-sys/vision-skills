/**
 * Background daemon management: start/stop/status plus OS-level autostart.
 *
 * The daemon runs the REST server (`dist/server/start.js`) hidden in the
 * background, writes a PID file under `~/.vision-skills`, and can register
 * itself to launch at login (Windows Run key / VBS launcher, Linux
 * XDG autostart, macOS LaunchAgent).
 */

import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DAEMON_DIR_NAME = '.vision-skills';
export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
export const RUN_VALUE_NAME = 'VisionSkillsDaemon';
export const AUTOSTART_FILE = 'vision-skills-daemon.vbs';

export function daemonDir(): string {
  return process.env.VISION_SKILLS_DAEMON_DIR ?? join(homedir(), DAEMON_DIR_NAME);
}

export function pidFile(): string {
  return join(daemonDir(), 'daemon.pid');
}

export function portFile(): string {
  return join(daemonDir(), 'daemon.port');
}

export function logFile(): string {
  return join(daemonDir(), 'daemon.log');
}

export function readPid(): number | null {
  try {
    const raw = readFileSync(pidFile(), 'utf8').trim();
    const pid = Number(raw);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function readPort(): number | null {
  try {
    const raw = readFileSync(portFile(), 'utf8').trim();
    const port = Number(raw);
    return Number.isSafeInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

export function writePid(pid: number): void {
  mkdirSync(daemonDir(), { recursive: true });
  writeFileSync(pidFile(), String(pid), 'utf8');
}

export function clearPid(): void {
  try {
    rmSync(pidFile(), { force: true });
    rmSync(portFile(), { force: true });
  } catch {
    // ignore
  }
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function defaultServerEntry(): string {
  return fileURLToPath(new URL('./server/start.js', import.meta.url));
}

export function tailLog(lines = 20): string[] {
  try {
    const content = readFileSync(logFile(), 'utf8');
    const entries = content.split(/\r?\n/).filter(Boolean);
    return lines <= 0 ? [] : entries.slice(-lines);
  } catch {
    return [];
  }
}

export async function isHealthy(host: string, port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_500);
    try {
      const response = await fetch(`http://${host}:${port}/health`, { signal: controller.signal });
      return response.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

export interface DaemonStartOptions {
  port?: number;
  host?: string;
  entry?: string;
  waitMs?: number;
}

export interface StartedDaemon {
  pid: number;
  port: number;
  host: string;
}

export async function startDaemon(options: DaemonStartOptions = {}): Promise<StartedDaemon> {
  const existing = readPid();
  if (existing !== null && processAlive(existing)) {
    throw new Error(`Vision Skills daemon is already running (PID ${existing})`);
  }
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? Number(process.env.API_PORT ?? 8000);
  const entry = options.entry ?? defaultServerEntry();
  if (!existsSync(entry)) {
    throw new Error(`Server entry not found: ${entry}. Run 'npm run build' first.`);
  }

  mkdirSync(daemonDir(), { recursive: true });
  const log = openSync(logFile(), 'a');
  const env = {
    ...process.env,
    API_HOST: host,
    API_PORT: String(port),
    VISION_SKILLS_DAEMON: '1',
  };
  const child = spawnDetached(process.execPath, [entry], env, log);
  child.unref();
  if (child.pid === undefined) {
    throw new Error('Failed to spawn daemon process (no PID assigned)');
  }
  writePid(child.pid);
  try {
    writeFileSync(portFile(), String(port), 'utf8');
  } catch {
    // port file is best-effort; health checks still use the passed port
  }

  const waitMs = options.waitMs ?? 15_000;
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Daemon exited during startup (code ${child.exitCode ?? child.signalCode}); see ${logFile()}`);
    }
    if (await isHealthy(host, port)) {
      return { pid: child.pid, port, host };
    }    if (Date.now() > deadline) {
      throw new Error(`Daemon did not become ready within ${waitMs}ms; see ${logFile()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function spawnDetached(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  log: number,
) {
  return spawn(command, args, {
    detached: true,
    env,
    stdio: ['ignore', log, log],
    windowsHide: true,
  });
}

export async function stopDaemon(): Promise<boolean> {
  const pid = readPid();
  if (pid === null || !processAlive(pid)) {
    clearPid();
    return false;
  }
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve());
    });
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!processAlive(pid)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  clearPid();
  return true;
}

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  healthy: boolean;
  log: string[];
}

export async function statusDaemon(port?: number): Promise<DaemonStatus> {
  const pid = readPid();
  const alive = pid !== null && processAlive(pid);
  const portValue = port ?? readPort() ?? Number(process.env.API_PORT ?? 8000);
  const healthy = alive ? await isHealthy('127.0.0.1', portValue) : false;
  return { running: alive, pid, healthy, log: tailLog(5) };
}

// ------------------------------------------------------------------ autostart

export function windowsAutostartRegArgs(launcher: string): string[] {
  return ['add', RUN_KEY, '/v', RUN_VALUE_NAME, '/t', 'REG_SZ', '/d', `wscript.exe "${launcher}"`, '/f'];
}

export function windowsAutostartRemoveArgs(): string[] {
  return ['delete', RUN_KEY, '/v', RUN_VALUE_NAME, '/f'];
}

export function windowsLauncherVbs(nodePath: string, entry: string): string {
  return `CreateObject("WScript.Shell").Run """${nodePath}"" ""${entry}""", 0, False\n`;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (error) => (error ? reject(error) : resolve()));
  });
}

export async function installAutostart(): Promise<string> {
  if (process.platform === 'win32') return installWindowsAutostart();
  if (process.platform === 'linux') return installLinuxAutostart();
  if (process.platform === 'darwin') return installMacAutostart();
  throw new Error(`Autostart is not supported on ${process.platform}`);
}

export async function uninstallAutostart(): Promise<boolean> {
  if (process.platform === 'win32') return uninstallWindowsAutostart();
  if (process.platform === 'linux') return uninstallLinuxAutostart();
  if (process.platform === 'darwin') return uninstallMacAutostart();
  throw new Error(`Autostart is not supported on ${process.platform}`);
}

async function installWindowsAutostart(): Promise<string> {
  const launcher = join(daemonDir(), AUTOSTART_FILE);
  mkdirSync(daemonDir(), { recursive: true });
  writeFileSync(launcher, windowsLauncherVbs(process.execPath, defaultServerEntry()), 'utf8');
  await run('reg', windowsAutostartRegArgs(launcher));
  return launcher;
}

async function uninstallWindowsAutostart(): Promise<boolean> {
  try {
    await run('reg', windowsAutostartRemoveArgs());
  } catch {
    // key/value not present — treat as uninstalled
  }
  try {
    rmSync(join(daemonDir(), AUTOSTART_FILE), { force: true });
  } catch {
    // ignore
  }
  return true;
}

function linuxAutostartFile(): string {
  return join(homedir(), '.config', 'autostart', 'vision-skills-daemon.desktop');
}

async function installLinuxAutostart(): Promise<string> {
  const file = linuxAutostartFile();
  mkdirSync(join(homedir(), '.config', 'autostart'), { recursive: true });
  writeFileSync(file, [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Vision Skills Daemon',
    'Exec=node ' + defaultServerEntry(),
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n'), 'utf8');
  return file;
}

async function uninstallLinuxAutostart(): Promise<boolean> {
  rmSync(linuxAutostartFile(), { force: true });
  return true;
}

function macLaunchAgentFile(): string {
  return join(homedir(), 'Library', 'LaunchAgents', 'com.vision-skills.daemon.plist');
}

async function installMacAutostart(): Promise<string> {
  const file = macLaunchAgentFile();
  mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.vision-skills.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${defaultServerEntry()}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict>
</plist>
`;
  writeFileSync(file, plist, 'utf8');
  await run('launchctl', ['load', file]).catch(() => undefined);
  return file;
}

async function uninstallMacAutostart(): Promise<boolean> {
  const file = macLaunchAgentFile();
  await run('launchctl', ['unload', file]).catch(() => undefined);
  rmSync(file, { force: true });
  return true;
}
