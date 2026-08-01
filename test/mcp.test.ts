import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMcpServer } from '../src/mcp-server.js';

const response = {
  schemaVersion: '3.1.0', imageType: 'document', modeUsed: 'basic', entities: [], regions: [],
  layout: null, knowledgeGraph: { nodes: [], edges: [] }, tables: [], code: null,
  sceneGraph: { spatial: [], semantic: [] }, reasonerOutput: null, providerResults: [],
  costActualTotal: 0, latencyMsTotal: 1, confidence: 1,
  provenance: { requestId: 'x', requestedMode: 'basic', modeSelectionReason: 'test', classifier: 'test', providers: [], cacheHit: false },
  errors: [], warnings: [],
} as const;

describe('official MCP server', () => {
  const close: Array<() => Promise<void>> = [];
  afterEach(async () => Promise.all(close.splice(0).map((fn) => fn())));

  async function connect(vision: any, maxOutputChars = 10_000, options = {}) {
    const server = createMcpServer({ vision, maxOutputChars, ...options });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    close.push(() => client.close(), () => server.close());
    return client;
  }

  it('lists and calls tools through the official client', async () => {
    const analyze = vi.fn().mockResolvedValue(response);
    const client = await connect({ analyze, healthCheck: vi.fn().mockResolvedValue({ mock: true }) });
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['analyze', 'analyze_text', 'health']),
    );
    const result = await client.callTool({ name: 'analyze', arguments: { image: 'test.png', mode: 'basic' } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ data: { imageType: 'document' }, truncation: { truncated: false } });
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it('returns standards-compliant tool errors for execution failures', async () => {
    const client = await connect({ analyze: vi.fn().mockRejectedValue(new Error('no image')), healthCheck: vi.fn() });
    const result = await client.callTool({ name: 'analyze', arguments: { image: 'missing.png', mode: 'basic' } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'no image' }]);
  });

  it('bounds large results and reports truncation metadata', async () => {
    const client = await connect({ analyze: vi.fn().mockResolvedValue({ ...response, warnings: ['x'.repeat(1000)] }), healthCheck: vi.fn() }, 200);
    const result = await client.callTool({ name: 'analyze', arguments: { image: 'test.png', mode: 'basic' } });
    expect(result.structuredContent).toMatchObject({ truncation: { truncated: true, maxChars: 200 } });
    expect((result.content as Array<{ text: string }>)[0]!.text.length).toBeLessThanOrEqual(200);
  });

  it('preserves omitted/explicit auto mode and prefers an existing ambiguous path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vision-mcp-'));
    const path = join(directory, 'YWJj');
    await writeFile(path, 'file');
    const cwd = process.cwd();
    try {
      process.chdir(directory);
      const analyze = vi.fn().mockResolvedValue(response);
      const client = await connect({ analyze, healthCheck: vi.fn() });
      await client.callTool({ name: 'analyze', arguments: { image: 'YWJj' } });
      await client.callTool({ name: 'analyze', arguments: { image: 'data:image/png;base64,YWJjZA==', mode: 'auto' } });
      expect(analyze.mock.calls[0][0]).toBe('YWJj');
      expect(analyze.mock.calls[0][1].mode).toBeUndefined();
      expect(analyze.mock.calls[1][0]).toBe('data:image/png;base64,YWJjZA==');
      expect(analyze.mock.calls[1][1].mode).toBe('auto');
    } finally {
      process.chdir(cwd);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('round-trips clipboard images larger than 200KB without truncating base64', async () => {
    const image = Buffer.alloc(250_000, 0xa5);
    const client = await connect({ analyze: vi.fn(), healthCheck: vi.fn() }, 10, {
      maxClipboardBytes: image.length,
      readClipboardImage: () => image,
    });
    const result = await client.callTool({ name: 'clipboard', arguments: {} });
    const content = result.content as Array<{ type: string; data: string; mimeType: string }>;
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ format: 'png', bytes: image.length });
    expect(content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(Buffer.from(content[0]!.data, 'base64')).toEqual(image);
  });

  it('returns an explicit error instead of truncating an oversized clipboard image', async () => {
    const client = await connect({ analyze: vi.fn(), healthCheck: vi.fn() }, 10_000, {
      maxClipboardBytes: 200_000,
      readClipboardImage: () => Buffer.alloc(200_001),
    });
    const result = await client.callTool({ name: 'clipboard', arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]!.text).toMatch(/200001 bytes; maximum is 200000 bytes/);
  });
});
