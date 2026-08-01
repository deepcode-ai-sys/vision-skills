import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const helper = fileURLToPath(new URL('../scripts/add-json-mcp.mjs', import.meta.url));
const localEntry = resolve(fileURLToPath(new URL('../dist/mcp server.js', import.meta.url)));

function runHelper(path: string, format: string, key = 'AIza-test-key', useArguments = false): void {
  const command = 'node';
  const args = useArguments ? [helper, path, format, command, localEntry] : [helper, path, format];
  execFileSync(process.execPath, args, {
    env: {
      ...process.env,
      VISION_SKILLS_SETUP_KEY: key,
      ...(useArguments ? {} : {
        VISION_SKILLS_MCP_COMMAND: command,
        VISION_SKILLS_MCP_ENTRY: localEntry,
      }),
    },
    stdio: 'pipe',
  });
}

describe('integration setup JSON helper', () => {
  it('creates an OpenCode config with the absolute local command from the environment', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'vision-setup-')), 'opencode.json');
    runHelper(path, 'opencode');

    const config = JSON.parse(readFileSync(path, 'utf8'));
    expect(config.$schema).toBe('https://opencode.ai/config.json');
    expect(config.mcp['vision-skills'].command).toEqual([
      'node',
      localEntry,
    ]);
    expect(config.mcp['vision-skills'].env.GEMINI_API_KEYS).toBe('AIza-test-key');
  });

  it('preserves unrelated fields and updates an existing server idempotently', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'vision-setup-')), 'mcp.json');
    writeFileSync(path, JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } }));

    runHelper(path, 'standard', 'AIza-first');
    runHelper(path, 'standard', 'AIza-second');

    const updated = readFileSync(path, 'utf8');
    runHelper(path, 'standard', 'AIza-second');
    expect(readFileSync(path, 'utf8')).toBe(updated);

    const config = JSON.parse(updated);
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
      command: 'node',
      args: [localEntry],
    });
  });

  it('accepts command and an absolute path containing spaces as arguments', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'vision setup ')), 'continue.json');
    runHelper(path, 'continue', 'AIza-test-key', true);

    const config = JSON.parse(readFileSync(path, 'utf8'));
    expect(config.mcpServers['vision-skills']).toEqual({
      type: 'stdio',
      command: 'node',
      args: [localEntry],
      env: { GEMINI_API_KEYS: 'AIza-test-key' },
    });
  });

  it('rejects a relative MCP entry path', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'vision-setup-')), 'mcp.json');
    expect(() => execFileSync(process.execPath, [helper, path, 'standard', 'node', 'dist/mcp-server.js'], {
      env: { ...process.env, VISION_SKILLS_SETUP_KEY: 'AIza-test-key' },
      stdio: 'pipe',
    })).toThrow();
  });

  it('rejects malformed existing JSON instead of overwriting it', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'vision-setup-')), 'mcp.json');
    writeFileSync(path, '{ invalid');

    expect(() => runHelper(path, 'standard')).toThrow();
    expect(readFileSync(path, 'utf8')).toBe('{ invalid');
  });
});
