import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(join(tmpdir(), 'vision-skills-package-'));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is required to run package smoke tests');
const runNpm = (args, options) => process.platform === 'win32'
  ? execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm', ...args], options)
  : execFileSync(process.execPath, [npmCli, ...args], options);
try {
  const packed = JSON.parse(runNpm(['pack', '--json'], { cwd: root, encoding: 'utf8' }));
  const tarball = join(root, packed[0].filename);
  try {
    runNpm(['init', '-y'], { cwd: temporary, stdio: 'ignore' });
    runNpm(['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: temporary, stdio: 'pipe', timeout: 60_000 });
    const installed = join(temporary, 'node_modules', 'vision-skills');
    console.log('Checking installed exports');
    execFileSync(process.execPath, ['--input-type=module', '--eval', [
      "import { VisionSkills } from 'vision-skills';",
      "import { createServer } from 'vision-skills/server';",
      "import { createMcpServer } from 'vision-skills/mcp';",
      "if (![VisionSkills, createServer, createMcpServer].every((value) => typeof value === 'function')) throw new Error('Installed package exports are incomplete');",
    ].join('\n')], { cwd: temporary, stdio: 'inherit', timeout: 10_000 });
    for (const binary of ['vision-skills', 'vision-skills-mcp']) {
      const path = join(temporary, 'node_modules', '.bin', process.platform === 'win32' ? `${binary}.cmd` : binary);
      await access(path);
    }
    console.log('Running installed benchmark');
    execFileSync(process.execPath, [join(installed, 'benchmark', 'run.mjs'), 'mock'], { cwd: installed, stdio: 'inherit', timeout: 30_000 });
    const benchmark = JSON.parse(await readFile(join(installed, 'benchmark', 'results', 'mock.json'), 'utf8'));
    if (benchmark.aggregate.routingAccuracy !== 1 || benchmark.aggregate.calls < 1) throw new Error('Installed benchmark smoke failed');
    console.log('Installed package smoke passed');
  } finally {
    await rm(tarball, { force: true });
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
