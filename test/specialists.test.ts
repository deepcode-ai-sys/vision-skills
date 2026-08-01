import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { resolveConfig } from '../src/config.js';
import { BoundingBox, type Entity } from '../src/core/types.js';
import { VisionSkills } from '../src/vision-skills.js';
import sharp from 'sharp';
import {
  CanonicalV1Codec, DoclingJsonCodec, OmniParserV2Codec,
  OpenAiChatCompletionsCodec, PaddleOcrClassicCodec,
} from '../src/specialists/codecs.js';
import { composeSpecialists } from '../src/specialists/compose.js';
import { HttpSpecialistProvider, redactHeaders, type SpecialistProvider } from '../src/specialists/http.js';
import { SpecialistOrchestrator } from '../src/specialists/orchestrator.js';
import { SpecialistRegistry, SpecialistRouter } from '../src/specialists/router.js';
import { emptyCanonicalOutput, type SpecialistCanonicalOutput, type SpecialistsConfig } from '../src/specialists/types.js';

const fixture = async (name: string): Promise<unknown> => JSON.parse(await readFile(
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8',
));

const config: SpecialistsConfig = {
  providers: [
    { id: 'first', protocol: 'canonical-v1', endpoint: 'http://localhost:9000/analyze', capabilities: ['ocr', 'objects'] },
    { id: 'second', protocol: 'canonical-v1', endpoint: 'http://127.0.0.1:9001/analyze', capabilities: ['ocr', 'objects'] },
  ],
  routes: {
    ocr: { providers: ['first', 'second'], mode: 'replace' },
    objects: { providers: ['first', 'second'], mode: 'augment' },
  },
};

class FakeProvider implements SpecialistProvider {
  readonly capabilities = new Set(['ocr', 'objects'] as const);
  calls: string[][] = [];
  constructor(readonly id: string, private readonly fail = false) {}
  async call(_image: Buffer, capabilities: Array<'ocr' | 'objects'>): Promise<SpecialistCanonicalOutput> {
    this.calls.push(capabilities);
    if (this.fail) throw new Error('expected failure');
    const output = emptyCanonicalOutput();
    output.text = [{ text: 'special', bbox: [1, 2, 3, 4], confidence: null }];
    output.objects = [{ label: 'panel', bbox: [0, 0, 10, 10], confidence: 0.8 }];
    return output;
  }
}

describe('specialist configuration and routing', () => {
  it('accepts localhost and rejects incomplete OpenAI providers', () => {
    expect(resolveConfig({ useMockProviders: true, specialists: config }).specialists).toEqual(config);
    expect(() => resolveConfig({ useMockProviders: true, specialists: {
      providers: [{ id: 'qwen', protocol: 'openai-chat-completions', endpoint: 'http://localhost:8000/v1/chat/completions', capabilities: ['ocr'] }],
      routes: { ocr: { providers: ['qwen'], mode: 'replace' } },
    } })).toThrow(/requires model/);
  });

  it('fails visibly for missing providers and unsupported capabilities', () => {
    expect(() => new SpecialistRouter({ ...config, routes: { ocr: { providers: ['missing'], mode: 'replace' } } })).toThrow(/missing provider/);
    expect(() => new SpecialistRouter({
      providers: [{ id: 'ocr', protocol: 'canonical-v1', endpoint: 'http://localhost', capabilities: ['ocr'] }],
      routes: { ui: { providers: ['ocr'], mode: 'augment' } },
    })).toThrow(/does not declare capability/);
    expect(() => new SpecialistRegistry([...config.providers, config.providers[0]!])).toThrow(/Duplicate/);
  });

  it('dedupes a provider call across capabilities', async () => {
    const first = new FakeProvider('first');
    const run = await new SpecialistOrchestrator(config, [first, new FakeProvider('second')]).run(Buffer.from('image'));
    expect(first.calls).toEqual([['ocr', 'objects']]);
    expect(run.usage.calls).toBe(1);
    expect(run.route.map((route) => route.selectedProvider)).toEqual(['first', 'first']);
  });

  it('uses only the explicit fallback chain and records attempts', async () => {
    const first = new FakeProvider('first', true);
    const second = new FakeProvider('second');
    const run = await new SpecialistOrchestrator(config, [first, second]).run(Buffer.from('image'));
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(1);
    expect(run.usage.calls).toBe(2);
    expect(run.route[0]!.attempts).toEqual(['first', 'second']);
  });

  it('returns failed traces when configured chains are exhausted', async () => {
    const run = await new SpecialistOrchestrator(config, [
      new FakeProvider('first', true), new FakeProvider('second', true),
    ]).run(Buffer.from('image'));
    expect(run.route).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: 'ocr', mode: 'replace', status: 'failed', selectedProvider: null }),
      expect.objectContaining({ capability: 'objects', mode: 'augment', status: 'failed', selectedProvider: null }),
    ]));
    expect(run.usage.calls).toBe(2);
  });
});

describe('specialist codecs', () => {
  it('round-trips canonical-v1 and rejects unknown fields', () => {
    const codec = new CanonicalV1Codec();
    const value = emptyCanonicalOutput();
    expect(codec.decode(value)).toEqual(value);
    expect(() => codec.decode({ ...value, surprise: true })).toThrow();
  });

  it('decodes PaddleOCR classic tuple JSON without inventing confidence', async () => {
    const output = new PaddleOcrClassicCodec().decode(await fixture('paddleocr-classic.json'));
    expect(output.text).toEqual([
      { text: 'Hello', bbox: [1, 2, 21, 12], confidence: 0.97 },
      { text: 'World', bbox: [2, 15, 30, 25], confidence: null },
    ]);
    expect(() => new PaddleOcrClassicCodec().decode({ predictions: [] })).toThrow(/Unknown paddleocr-classic/);
  });

  it('decodes the direct PaddleOCR classic JSON array shape', () => {
    const output = new PaddleOcrClassicCodec().decode([[[[[0, 0], [4, 0], [4, 2], [0, 2]], ['Direct', 0.5]]]]);
    expect(output.text).toEqual([{ text: 'Direct', bbox: [0, 0, 4, 2], confidence: 0.5 }]);
  });

  it('decodes the committed DoclingDocument JSON shape', async () => {
    const output = new DoclingJsonCodec().decode(await fixture('docling.json'));
    expect(output.text[0]).toEqual({ text: 'Invoice', bbox: [10, 20, 50, 30], confidence: null });
    expect(output.tables[0]).toEqual({ title: 'table', columns: ['Item', 'Price'], rows: [['Tea', '2']], bbox: [5, 40, 90, 80] });
    expect(() => new DoclingJsonCodec().decode({ document: {} })).toThrow(/Unknown docling-json/);
  });

  it('converts real-shaped OmniParser normalized ratio boxes to pixels', async () => {
    const output = new OmniParserV2Codec().decode(
      await fixture('omniparser-v2.json'),
      { width: 1200, height: 800 },
    );
    expect(output.ui[0]).toMatchObject({ label: 'button', text: 'OK', bbox: [120, 160, 600, 480], confidence: null, clickable: true });
    expect(() => new OmniParserV2Codec().decode({ parsed_content_list: [{ type: 'button', bbox: [0.1, 0.2, 0.5, 0.6] }] })).toThrow(/image dimensions/);
  });

  it('orders and clamps malformed OmniParser ratio boxes before pixel conversion', () => {
    const output = new OmniParserV2Codec().decode({
      parsed_content_list: [{ type: 'button', content: 'Malformed', bbox: [1.2, 0.8, -0.1, 0.2] }],
    }, { width: 200, height: 100 });
    expect(output.ui[0]?.bbox).toEqual([0, 20, 200, 80]);
  });

  it('builds OpenAI data URLs using the MIME type of processed bytes', async () => {
    const codec = new OpenAiChatCompletionsCodec();
    const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).jpeg().toBuffer();
    const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'transparent' } }).png().toBuffer();
    const jpegRequest = codec.encode(jpeg, ['ocr'], 'Qwen2.5-VL') as any;
    const pngRequest = codec.encode(png, ['ocr'], 'Qwen2.5-VL') as any;
    expect(jpegRequest.model).toBe('Qwen2.5-VL');
    expect(jpegRequest.messages[0].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(pngRequest.messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
    const canonical = emptyCanonicalOutput();
    expect(codec.decode({ choices: [{ message: { content: JSON.stringify(canonical) } }] })).toEqual(canonical);
    expect(() => codec.decode({ choices: [{ message: { content: 'not json' } }] })).toThrow(/not JSON/);
  });

  it('keeps successful routes when another augment or replacement route fails', async () => {
    class SplitProvider extends FakeProvider {
      override async call(image: Buffer, capabilities: Array<'ocr' | 'objects'>) {
        if (capabilities.includes('objects')) throw new Error('objects unavailable');
        return super.call(image, capabilities);
      }
    }
    const splitConfig: SpecialistsConfig = {
      providers: [
        { id: 'ocr-ok', protocol: 'canonical-v1', endpoint: 'http://localhost/ocr', capabilities: ['ocr'] },
        { id: 'objects-bad', protocol: 'canonical-v1', endpoint: 'http://localhost/objects', capabilities: ['objects'] },
      ],
      routes: { ocr: { providers: ['ocr-ok'], mode: 'augment' }, objects: { providers: ['objects-bad'], mode: 'replace' } },
    };
    const run = await new SpecialistOrchestrator(splitConfig, [new FakeProvider('ocr-ok'), new SplitProvider('objects-bad')]).run(Buffer.from('image'));
    expect(run.outputs.ocr?.text[0]?.text).toBe('special');
    expect(run.route).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: 'ocr', status: 'succeeded' }),
      expect.objectContaining({ capability: 'objects', mode: 'replace', status: 'failed' }),
    ]));
  });
});

describe('specialist HTTP and composition', () => {
  it('disables redirects, sends auth, enforces response shape, and redacts secrets', async () => {
    const canonical = emptyCanonicalOutput();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(canonical), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const provider = new HttpSpecialistProvider({
        id: 'local', protocol: 'canonical-v1', endpoint: 'http://localhost:8080/analyze',
        capabilities: ['ocr'], apiKey: 'secret', maxResponseBytes: 10_000,
      });
      await provider.call(Buffer.from('x'), ['ocr']);
      expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
      expect(fetchMock.mock.calls[0]![1].headers.authorization).toBe('Bearer secret');
      expect(redactHeaders({ Authorization: 'Bearer secret', Accept: 'json' })).toEqual({ Authorization: '[REDACTED]', Accept: 'json' });
    } finally { vi.unstubAllGlobals(); }
  });

  it('rejects oversized responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(emptyCanonicalOutput()), { status: 200 })));
    try {
      const provider = new HttpSpecialistProvider({ id: 'small', protocol: 'canonical-v1', endpoint: 'http://localhost', capabilities: ['ocr'], maxResponseBytes: 2 });
      await expect(provider.call(Buffer.from('x'), ['ocr'])).rejects.toThrow(/exceeds 2 bytes/);
    } finally { vi.unstubAllGlobals(); }
  });

  it('replaces OCR, augments objects, and maps null confidence honestly', () => {
    const base: Entity[] = [
      { entityId: 'text', label: 'text_block', bbox: new BoundingBox(0, 0, 1, 1), confidence: 1, metadata: {}, sourcePlugins: ['gemini'] },
      { entityId: 'car', label: 'vehicle.car', bbox: new BoundingBox(0, 0, 2, 2), confidence: 0.9, metadata: {}, sourcePlugins: ['gemini'] },
    ];
    const output = emptyCanonicalOutput();
    output.text = [{ text: 'special', bbox: [1, 2, 3, 4], confidence: null }];
    output.objects = [{ label: 'panel', bbox: [0, 0, 10, 10], confidence: null }];
    const composed = composeSpecialists({ entities: base, tables: [], regions: [], layout: null, code: null }, {
      outputs: { ocr: output, objects: output },
      route: [
        { capability: 'ocr', mode: 'replace', configuredChain: ['local'], attempts: ['local'], selectedProvider: 'local', status: 'succeeded' },
        { capability: 'objects', mode: 'augment', configuredChain: ['local'], attempts: ['local'], selectedProvider: 'local', status: 'succeeded' },
      ],
      usage: { calls: 1, latencyMs: 1, byProvider: { local: 1 }, callMetrics: [] },
    });
    expect(composed.entities.find((entity) => entity.entityId === 'text')).toBeUndefined();
    expect(composed.entities.find((entity) => entity.label === 'vehicle.car')).toBeDefined();
    expect(composed.entities.find((entity) => entity.text === 'special')?.confidence).toBeNull();
  });

  it('integrates replacement into VisionResponse and suppresses the legacy OCR call', async () => {
    const canonical = emptyCanonicalOutput();
    canonical.text = [{ text: 'HTTP OCR', bbox: [1, 2, 30, 12], confidence: null }];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(canonical), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const vision = new VisionSkills({
        useMockProviders: true,
        cacheEnabled: false,
        specialists: {
          providers: [{ id: 'ocr-http', protocol: 'canonical-v1', endpoint: 'http://localhost:8080/analyze', capabilities: ['ocr'] }],
          routes: { ocr: { providers: ['ocr-http'], mode: 'replace' } },
        },
      });
      const image = await sharp({ create: { width: 40, height: 30, channels: 3, background: 'white' } }).jpeg().toBuffer();
      const result = await vision.analyze(image, { mode: 'basic' });
      expect(result.providerResults).toEqual([]);
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]).toMatchObject({ text: 'HTTP OCR', confidence: null, sourcePlugins: ['ocr-http'] });
      expect(result.route?.[0]).toMatchObject({ capability: 'ocr', selectedProvider: 'ocr-http', mode: 'replace' });
      expect(result.usage?.calls).toBe(1);
      expect(result.provenance.providers).toContain('ocr-http');
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });

  it('obeys selected mode policy for explicit specialist routes', async () => {
    const canonical = emptyCanonicalOutput();
    canonical.text = [{ text: 'mode text', bbox: [1, 2, 30, 12], confidence: 0.8 }];
    canonical.objects = [{ label: 'mode object', bbox: [1, 2, 30, 12], confidence: 0.7 }];
    canonical.tables = [{ title: 'mode table', columns: ['a'], rows: [['b']] }];
    canonical.regions = [{ id: 'r', name: 'body', purpose: 'content' }];
    canonical.layout = { color: { dominant: 'blue' } };
    canonical.code = { language: 'ts', functions: [], errors: [], snippet: 'const x = 1' };
    const calls: string[][] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      calls.push((JSON.parse(String(init?.body)) as { capabilities: string[] }).capabilities);
      return new Response(JSON.stringify(canonical), { status: 200 });
    }));
    try {
      const capabilities = ['ocr', 'objects', 'ui', 'tables', 'regions', 'layout', 'code'] as const;
      const vision = new VisionSkills({ useMockProviders: true, cacheEnabled: false, specialists: {
        providers: [{ id: 'all', protocol: 'canonical-v1', endpoint: 'http://localhost/all', capabilities: [...capabilities] }],
        routes: Object.fromEntries(capabilities.map((capability) => [capability, { providers: ['all'], mode: 'augment' }])) as SpecialistsConfig['routes'],
      } });
      const image = await sharp({ create: { width: 40, height: 30, channels: 3, background: 'white' } }).jpeg().toBuffer();
      const basic = await vision.analyze(image, { mode: 'basic' });
      expect(calls).toEqual([['ocr']]);
      expect(basic.route?.map((route) => route.capability)).toEqual(['ocr']);
      expect(basic.entities.some((entity) => entity.text === 'mode text')).toBe(true);
      expect(basic.tables).toEqual([]);
      calls.length = 0;
      for (const mode of ['standard', 'advanced', 'full'] as const) {
        calls.length = 0;
        const result = await vision.analyze(image, { mode });
        expect(calls).toEqual([[...capabilities]]);
        expect(result.route).toHaveLength(capabilities.length);
        expect(result.entities.some((entity) => entity.label === 'mode object')).toBe(true);
        expect(result.tables[0]?.title).toBe('mode table');
        expect(result.regions[0]?.name).toBe('body');
        expect(result.layout?.color?.dominant).toBe('blue');
        expect(result.code?.language).toBe('ts');
        if (mode === 'standard') {
          expect(result.sceneGraph.semantic).toEqual([]);
          expect(result.reasonerOutput).toBeNull();
        }
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it('returns mixed-route partial results and distinguishes augment warnings from replacement errors', async () => {
    const canonical = emptyCanonicalOutput();
    canonical.text = [{ text: 'survived', bbox: [1, 2, 30, 12], confidence: 0.6 }];
    vi.stubGlobal('fetch', vi.fn(async (url) => String(url).endsWith('/ocr')
      ? new Response(JSON.stringify(canonical), { status: 200 })
      : new Response('unavailable', { status: 503 })));
    try {
      const vision = new VisionSkills({ useMockProviders: true, cacheEnabled: false, specialists: {
        providers: [
          { id: 'ocr-ok', protocol: 'canonical-v1', endpoint: 'http://localhost/ocr', capabilities: ['ocr'] },
          { id: 'objects-bad', protocol: 'canonical-v1', endpoint: 'http://localhost/objects', capabilities: ['objects'] },
          { id: 'tables-bad', protocol: 'canonical-v1', endpoint: 'http://localhost/tables', capabilities: ['tables'] },
        ],
        routes: {
          ocr: { providers: ['ocr-ok'], mode: 'augment' },
          objects: { providers: ['objects-bad'], mode: 'replace' },
          tables: { providers: ['tables-bad'], mode: 'augment' },
        },
      } });
      const image = await sharp({ create: { width: 40, height: 30, channels: 3, background: 'white' } }).jpeg().toBuffer();
      const result = await vision.analyze(image, { mode: 'standard' });
      expect(result.entities.some((entity) => entity.text === 'survived')).toBe(true);
      expect(result.route).toEqual(expect.arrayContaining([
        expect.objectContaining({ capability: 'ocr', status: 'succeeded' }),
        expect.objectContaining({ capability: 'objects', mode: 'replace', status: 'failed' }),
        expect.objectContaining({ capability: 'tables', mode: 'augment', status: 'failed' }),
      ]));
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('Required replacement capability')]));
      expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('[tables] specialist route failed')]));
      expect(result.usage?.calls).toBe(3);
    } finally { vi.unstubAllGlobals(); }
  });

  it('incorporates non-null specialist confidence into aggregate confidence', async () => {
    const image = await sharp({ create: { width: 40, height: 30, channels: 3, background: 'white' } }).jpeg().toBuffer();
    const analyzeWithConfidence = async (confidence: number | null) => {
      const canonical = emptyCanonicalOutput();
      canonical.text = [{ text: 'confidence', bbox: [1, 2, 30, 12], confidence }];
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(canonical), { status: 200 })));
      const vision = new VisionSkills({ useMockProviders: true, cacheEnabled: false, specialists: {
        providers: [{ id: 'ocr', protocol: 'canonical-v1', endpoint: 'http://localhost/ocr', capabilities: ['ocr'] }],
        routes: { ocr: { providers: ['ocr'], mode: 'augment' } },
      } });
      return (await vision.analyze(image, { mode: 'basic' })).confidence;
    };
    try {
      expect(await analyzeWithConfidence(0)).toBeLessThan(await analyzeWithConfidence(null));
    } finally { vi.unstubAllGlobals(); }
  });
});
