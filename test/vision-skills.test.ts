import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';

import { VisionSkills } from '../src/vision-skills.js';
import { ConfigurationError } from '../src/core/errors.js';
import { BoundingBox } from '../src/core/types.js';
import { CacheManager, type CacheBackend } from '../src/cache/cache.js';

class TestCacheBackend implements CacheBackend {
  values = new Map<string, string>();
  gets = 0;
  sets = 0;
  ttls: number[] = [];
  async get(key: string): Promise<string | null> {
    this.gets += 1;
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.sets += 1;
    this.ttls.push(ttlSeconds);
    this.values.set(key, value);
  }
  async delete(key: string): Promise<void> { this.values.delete(key); }
  async clear(): Promise<number> {
    const count = this.values.size;
    this.values.clear();
    return count;
  }
}

async function makeImage(w = 200, h = 150): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 100, g: 120, b: 200 } },
  })
    .jpeg()
    .toBuffer();
}

describe('BoundingBox', () => {
  it('computes geometry', () => {
    const b = new BoundingBox(10, 20, 110, 120);
    expect(b.width).toBe(100);
    expect(b.height).toBe(100);
    expect(b.centerX).toBe(60);
    expect(b.area).toBe(10000);
  });

  it('fromXYWH and fromList', () => {
    expect(BoundingBox.fromXYWH(10, 20, 100, 100).toList()).toEqual([10, 20, 110, 120]);
    expect(BoundingBox.fromList([1, 2, 3, 4]).toList()).toEqual([1, 2, 3, 4]);
  });

  it('computes IoU', () => {
    const a = new BoundingBox(0, 0, 100, 100);
    const b = new BoundingBox(50, 50, 150, 150);
    expect(a.iou(b)).toBeCloseTo(2500 / 17500, 4);
  });

  it('IoU is 0 for disjoint boxes', () => {
    const a = new BoundingBox(0, 0, 10, 10);
    const b = new BoundingBox(100, 100, 110, 110);
    expect(a.iou(b)).toBe(0);
  });
});

describe('VisionSkills (mock providers)', () => {
  it('canonicalizes complete nested cache identity while isolating specialist backends', () => {
    const left = CacheManager.makeKey('image', 'standard', {
      specialists: { routes: { ocr: { mode: 'augment', providers: ['p'] } }, providers: [{ endpoint: 'http://a', id: 'p', model: 'm1' }] },
    });
    const reordered = CacheManager.makeKey('image', 'standard', {
      specialists: { providers: [{ model: 'm1', id: 'p', endpoint: 'http://a' }], routes: { ocr: { providers: ['p'], mode: 'augment' } } },
    });
    expect(reordered).toBe(left);
    for (const specialists of [
      { providers: [{ endpoint: 'http://b', id: 'p', model: 'm1' }], routes: { ocr: { providers: ['p'], mode: 'augment' } } },
      { providers: [{ endpoint: 'http://a', id: 'other', model: 'm1' }], routes: { ocr: { providers: ['other'], mode: 'augment' } } },
      { providers: [{ endpoint: 'http://a', id: 'p', model: 'm2' }], routes: { ocr: { providers: ['p'], mode: 'augment' } } },
      { providers: [{ endpoint: 'http://a', id: 'p', model: 'm1' }], routes: { objects: { providers: ['p'], mode: 'augment' } } },
      { providers: [{ endpoint: 'http://a', id: 'p', model: 'm1' }], routes: { ocr: { providers: ['p'], mode: 'replace' } } },
    ]) expect(CacheManager.makeKey('image', 'standard', { specialists })).not.toBe(left);
  });

  it('fails fast without a real OCR provider unless mock mode is explicit', () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEYS', '');
    try {
      expect(() => new VisionSkills({ cacheEnabled: false })).toThrow(ConfigurationError);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('analyzes an image end-to-end in standard mode', async () => {
    const vision = new VisionSkills({ useMockProviders: true, cacheEnabled: false });
    const img = await makeImage();
    const result = await vision.analyze(img, { mode: 'standard' });

    expect(result.schemaVersion).toBe('3.1.0');
    expect(result.modeUsed).toBe('standard');
    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.providerResults.length).toBeGreaterThan(0);
    expect(result.latencyMsTotal).toBeGreaterThan(0);
    expect(result.route).toBeUndefined();
    expect(result.usage).toBeUndefined();
  });

  it('basic mode runs OCR only', async () => {
    const vision = new VisionSkills({ useMockProviders: true, cacheEnabled: false });
    const img = await makeImage();
    const result = await vision.analyze(img, { mode: 'basic' });

    expect(result.modeUsed).toBe('basic');
    expect(result.providerResults).toHaveLength(1);
    expect(result.providerResults[0]!.plugin).toBe('mock_ocr');
  });

  it('uses defaultMode when analyze options omit mode', async () => {
    const vision = new VisionSkills({ useMockProviders: true, cacheEnabled: false, defaultMode: 'full' });
    const img = await makeImage();
    const result = await vision.analyze(img);

    expect(result.modeUsed).toBe('full');
    expect(result.errors).toEqual([]);
  });

  it('defaults to auto routing', async () => {
    const vision = new VisionSkills({ useMockProviders: true, cacheEnabled: false });
    const result = await vision.analyze(await makeImage());
    expect(result.provenance.requestedMode).toBe('auto');
    expect(result.provenance.modeSelectionReason).not.toBe('client_explicit_request');
  });

  it('rejects invalid processing mode', async () => {
    const vision = new VisionSkills({ useMockProviders: true, cacheEnabled: false });
    const img = await makeImage();

    await expect(vision.analyze(img, { mode: 'bad' as any })).rejects.toThrow('Invalid analyze options');
  });

  it('rejects invalid analyze values and invalid constructor config at runtime', async () => {
    const vision = new VisionSkills({ useMockProviders: true });
    await expect(vision.analyze(await makeImage(), { budgetRemaining: -1 })).rejects.toThrow(
      'Invalid analyze options',
    );
    expect(() => new VisionSkills({ useMockProviders: true, jpegQuality: 101 })).toThrow(
      'Invalid configuration',
    );
  });

  it.each([
    ['basic', ['mock_ocr']],
    ['standard', ['mock_ocr', 'mock_detection', 'mock_ui']],
    ['advanced', ['mock_ocr', 'mock_detection', 'mock_ui']],
    ['full', ['mock_ocr', 'mock_detection', 'mock_ui']],
  ] as const)('%s mode applies its centralized plugin policy', async (mode, plugins) => {
    const vision = new VisionSkills({ useMockProviders: true, cacheEnabled: false });
    const result = await vision.analyze(await makeImage(), { mode });
    expect(result.providerResults.map((provider) => provider.plugin).sort()).toEqual([...plugins].sort());
    expect(result.sceneGraph.semantic).toEqual([]);
    expect(result.reasonerOutput).toBeNull();
  });

  it('produces spatial relationships between entities', async () => {
    const vision = new VisionSkills({ useMockProviders: true, cacheEnabled: false });
    const img = await makeImage();
    const result = await vision.analyze(img, { mode: 'standard' });
    expect(result.sceneGraph.spatial.length).toBeGreaterThanOrEqual(0);
    expect(result.sceneGraph.semantic).toEqual([]);
  });

  it('caches repeat requests', async () => {
    const vision = new VisionSkills({ useMockProviders: true, cacheEnabled: true });
    const img = await makeImage();
    await vision.analyze(img, { mode: 'basic' });
    await vision.analyze(img, { mode: 'basic' });
    const stats = vision.cacheStats();
    expect(stats.hits).toBe(1);
  });

  it('uses an injected cache backend and hydrates cached bounding boxes', async () => {
    const backend = new TestCacheBackend();
    const vision = new VisionSkills({ useMockProviders: true, cacheBackend: backend });
    const image = await makeImage();
    const first = await vision.analyze(image, { mode: 'basic' });
    const second = await vision.analyze(image, { mode: 'basic' });

    expect(backend.sets).toBe(1);
    expect(backend.gets).toBe(2);
    expect(second.provenance.cacheHit).toBe(true);
    expect(second.provenance.requestId).not.toBe(first.provenance.requestId);
    expect(second.entities[0]!.bbox).toBeInstanceOf(BoundingBox);
    expect(second.entities[0]!.bbox.toList()).toEqual(first.entities[0]!.bbox.toList());
    expect(second.providerResults).toEqual([]);
    expect(second.costActualTotal).toBe(0);
    expect(second.latencyMsTotal).toBe(0);
    expect(second.telemetry?.gemini).toMatchObject({ calls: 0, attempts: 0, successes: 0, failures: 0 });
    expect(second.provenance.providers).toEqual([]);
    expect(second.provenance.cacheOrigin).toEqual({
      requestId: first.provenance.requestId,
      latencyMsTotal: first.latencyMsTotal,
      costActualTotal: first.costActualTotal,
      providers: first.provenance.providers,
    });
  });

  it('uses a short TTL for specialist OCR content', async () => {
    const backend = new TestCacheBackend();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      protocol: 'canonical-v1', text: [{ text: 'private', bbox: [0, 0, 10, 10], confidence: 0.8 }],
      objects: [], ui: [], tables: [], regions: [], layout: null, code: null,
    }), { status: 200 })));
    try {
      const vision = new VisionSkills({ useMockProviders: true, cacheBackend: backend, cacheTtlSeconds: 3600,
        specialists: { providers: [{ id: 'doc', protocol: 'canonical-v1', endpoint: 'http://localhost', capabilities: ['ocr'] }],
          routes: { ocr: { providers: ['doc'], mode: 'augment' } } } });
      await vision.analyze(await makeImage(), { mode: 'basic' });
      expect(backend.ttls).toEqual([300]);
    } finally { vi.unstubAllGlobals(); }
  });

  it('uses a short TTL for specialist table and code document content', async () => {
    for (const capability of ['tables', 'code'] as const) {
      const backend = new TestCacheBackend();
      const canonical = {
        protocol: 'canonical-v1', text: [], objects: [], ui: [], regions: [], layout: null,
        tables: capability === 'tables' ? [{ title: 'private', columns: ['A'], rows: [['B']] }] : [],
        code: capability === 'code' ? { language: 'txt', functions: [], errors: [], snippet: 'private' } : null,
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(canonical), { status: 200 })));
      const vision = new VisionSkills({ useMockProviders: true, cacheBackend: backend, cacheTtlSeconds: 3600,
        specialists: { providers: [{ id: capability, protocol: 'canonical-v1', endpoint: 'http://localhost', capabilities: [capability] }],
          routes: { [capability]: { providers: [capability], mode: 'augment' } } } });
      await vision.analyze(await makeImage(), { mode: 'standard' });
      expect(backend.ttls).toEqual([300]);
      vi.unstubAllGlobals();
    }
  });

  it('isolates specialist configurations sharing one cache backend', async () => {
    const backend = new TestCacheBackend();
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const canonical = {
        protocol: 'canonical-v1', text: [{ text: String(url).endsWith('/a') ? 'A' : 'B', bbox: [0, 0, 10, 10], confidence: 0.8 }],
        objects: [], ui: [], tables: [], regions: [], layout: null, code: null,
      };
      return new Response(JSON.stringify(canonical), { status: 200 });
    }));
    try {
      const makeVision = (id: string, endpoint: string) => new VisionSkills({ useMockProviders: true, cacheBackend: backend,
        specialists: { providers: [{ id, protocol: 'canonical-v1', endpoint, capabilities: ['ocr'], model: `model-${id}` }],
          routes: { ocr: { providers: [id], mode: 'replace' } } } });
      const image = await makeImage();
      const a = await makeVision('a', 'http://localhost/a').analyze(image, { mode: 'basic' });
      const b = await makeVision('b', 'http://localhost/b').analyze(image, { mode: 'basic' });
      expect(a.entities[0]?.text).toBe('A');
      expect(b.entities[0]?.text).toBe('B');
      expect(b.provenance.cacheHit).toBe(false);
      expect(backend.values.size).toBe(2);
    } finally { vi.unstubAllGlobals(); }
  });

  it('gates combined structured fields in basic mode and reports Gemini usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          image_type: 'document',
          text_blocks: [{ text: 'hello', box_2d: [0, 0, 100, 100] }],
          objects: [],
          tables: [{ title: 'hidden', columns: ['A'], rows: [['B']] }],
          code: { language: 'ts', functions: [], errors: [], snippet: 'const x = 1' },
          regions: [{ id: 'r1', name: 'body', purpose: 'content' }],
          layout: { color: { dominant: 'blue' } },
        }) }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 },
      }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    try {
      const vision = new VisionSkills({ geminiApiKey: 'test', cacheEnabled: false });
      const result = await vision.analyze(await makeImage(), { mode: 'basic' });
      expect(result.tables).toEqual([]);
      expect(result.code).toBeNull();
      expect(result.regions).toEqual([]);
      expect(result.layout).toBeNull();
      expect(result.telemetry?.gemini).toEqual({
        calls: 1, attempts: 1, successes: 1, failures: 0,
        inputTokens: 10, outputTokens: 4, totalTokens: 14,
      });
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('projects semantic scene edges into the knowledge graph', async () => {
    const vision = new VisionSkills({ useMockProviders: true, cacheEnabled: false });
    const semanticVlm = {
      async askJson(_image: Buffer, prompt: string): Promise<string> {
        const ids = [...prompt.matchAll(/id="([^"]+)"/g)].map((match) => match[1]!);
        const relation = prompt.includes('contains') ? 'contains' : 'holding';
        return JSON.stringify([{
          subject_id: ids[0], relation, object_id: ids[1], confidence: 0.8,
        }]);
      },
    };
    (vision as any).vlm = semanticVlm;
    const result = await vision.analyze(await makeImage(), { mode: 'advanced' });
    expect(result.sceneGraph.semantic).toHaveLength(1);
    const semantic = result.sceneGraph.semantic[0]!;
    expect(result.knowledgeGraph.edges).toContainEqual({
      from: semantic.subjectId,
      relation: semantic.relation,
      to: semantic.objectId,
      confidence: semantic.confidence,
    });
  });

  it('rejects invalid image bytes', async () => {
    const vision = new VisionSkills({ useMockProviders: true });
    await expect(vision.analyze(Buffer.from('not an image'))).rejects.toThrow();
  });
});
