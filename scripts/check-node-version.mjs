#!/usr/bin/env node

const [major, minor] = process.versions.node.split('.').map(Number);

if (major < 20 || (major === 20 && minor < 18)) {
  console.error(`Error: Node.js >=20.18 is required; found ${process.versions.node}. Install a supported version from https://nodejs.org`);
  process.exit(1);
}
