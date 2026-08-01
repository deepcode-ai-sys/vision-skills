#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const [configPath, format, keyArgument] = process.argv.slice(2);
const apiKey = keyArgument || process.env.VISION_SKILLS_SETUP_KEY;

if (!configPath || !format || !apiKey) {
  console.error('Usage: VISION_SKILLS_SETUP_KEY=... node add-json-mcp.mjs <config-path> <opencode|standard|vscode|continue>');
  process.exit(2);
}

let config = {};
try {
  const raw = await readFile(configPath, 'utf8');
  config = JSON.parse(raw.replace(/^\uFEFF/, ''));
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.error(`Cannot update ${configPath}: ${error.message}`);
    process.exit(1);
  }
}

const stdioServer = {
  command: 'npx',
  args: ['-y', '--package', 'vision-skills', 'vision-skills-mcp'],
  env: { GEMINI_API_KEYS: apiKey },
};

if (format === 'opencode') {
  config.$schema ??= 'https://opencode.ai/config.json';
  config.mcp ??= {};
  config.mcp['vision-skills'] = {
    type: 'local',
    command: ['npx', '-y', '--package', 'vision-skills', 'vision-skills-mcp'],
    enabled: true,
    env: { GEMINI_API_KEYS: apiKey },
  };
} else if (format === 'standard') {
  config.mcpServers ??= {};
  config.mcpServers['vision-skills'] = stdioServer;
} else if (format === 'vscode') {
  config.servers ??= {};
  config.servers['vision-skills'] = { type: 'stdio', ...stdioServer };
} else if (format === 'continue') {
  config.mcpServers ??= {};
  config.mcpServers['vision-skills'] = { type: 'stdio', ...stdioServer };
} else {
  console.error(`Unsupported config format: ${format}`);
  process.exit(2);
}

await mkdir(dirname(configPath), { recursive: true });
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
console.log(`Configured vision-skills in ${configPath}`);
