import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const helper = fileURLToPath(new URL('../scripts/add-json-mcp.mjs', import.meta.url));

function runHelper(path: string, format: string, key = 'AIza-test-key'): void {
  execFileSync(process.execPath, [helper, path, format], {
    env: { ...process.env, VISION_SKILLS_SETUP_KEY: key },
    stdio: 'pipe',
  });
}

describe('integration setup JSON helper', () => {
  it('creates an OpenCode config with the published package command', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'vision-setup-')), 'opencode.json');
    runHelper(path, 'opencode');

    const config = JSON.parse(readFileSync(path, 'utf8'));
    expect(config.$schema).toBe('https://opencode.ai/config.json');
    expect(config.mcp['vision-skills'].command).toEqual([
      'npx',
      '-y',
      '--package',
      'vision-skills',
      'vision-skills-mcp',
    ]);
    expect(config.mcp['vision-skills'].env.GEMINI_API_KEYS).toBe('AIza-test-key');
  });

  it('preserves unrelated fields and updates an existing server idempotently', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'vision-setup-')), 'mcp.json');
    writeFileSync(path, JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } }));

    runHelper(path, 'standard', 'AIza-first');
    runHelper(path, 'standard', 'AIza-second');

    const config = JSON.parse(readFileSync(path, 'utf8'));
    expect(config.theme).toBe('dark');
    expect(config.mcpServers.other).toEqual({ command: 'x' });
    expect(config.mcpServers['vision-skills'].env.GEMINI_API_KEYS).toBe('AIza-second');
  });

  it('writes the VS Code servers shape', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'vision-setup-')), 'mcp.json');
    runHelper(path, 'vscode');

    const config = JSON.parse(readFileSync(path, 'utf8'));
    expect(config.servers['vision-skills']).toMatchObject({
      type: 'stdio',
      command: 'npx',
    });
  });

  it('rejects malformed existing JSON instead of overwriting it', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'vision-setup-')), 'mcp.json');
    writeFileSync(path, '{ invalid');

    expect(() => runHelper(path, 'standard')).toThrow();
    expect(readFileSync(path, 'utf8')).toBe('{ invalid');
  });
});
