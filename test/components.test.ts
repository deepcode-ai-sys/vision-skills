import { afterEach, describe, it, expect, vi } from 'vitest';

import { SemanticGraphBuilder, type VLMClient } from '../src/scene-graph/semantic.js';
import { Reasoner } from '../src/reasoner/reasoner.js';
import { SpatialGraphBuilder } from '../src/scene-graph/spatial.js';
import { ImageProcessor } from '../src/utils/image.js';
import { BoundingBox, type Entity } from '../src/core/types.js';
import { ModeRouter } from '../src/core/router.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});
class FakeVLM implements VLMClient {
  calls = 0;
  constructor(private response: string) {}
  async askJson(): Promise<string> {
    this.calls += 1;
    return this.response;
  }
}

function entity(id: string, label: string, box: number[]): Entity {
  return {
    entityId: id,
    label,
    bbox: BoundingBox.fromList(box),
    confidence: 0.9,
    metadata: {},
    sourcePlugins: [],
  };
}

describe('SemanticGraphBuilder', () => {
  const entities = [
    entity('e1', 'person', [0, 0, 100, 200]),
    entity('e2', 'device.phone', [50, 80, 90, 140]),
  ];

  it('returns empty without VLM', async () => {
    const b = new SemanticGraphBuilder(null);
    expect(await b.build(Buffer.from(''), entities)).toEqual([]);
  });

  it('parses valid relation', async () => {
    const vlm = new FakeVLM(
      '[{"subject_id":"e1","relation":"holding","object_id":"e2","confidence":0.9}]',
    );
    const edges = await new SemanticGraphBuilder(vlm).build(Buffer.from(''), entities);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.relation).toBe('holding');
  });

  it('rejects invalid relation (near is spatial)', async () => {
    const vlm = new FakeVLM('[{"subject_id":"e1","relation":"near","object_id":"e2"}]');
    const edges = await new SemanticGraphBuilder(vlm).build(Buffer.from(''), entities);
    expect(edges).toHaveLength(0);
  });

  it('rejects unknown entity id', async () => {
    const vlm = new FakeVLM('[{"subject_id":"e1","relation":"holding","object_id":"e99"}]');
    const edges = await new SemanticGraphBuilder(vlm).build(Buffer.from(''), entities);
    expect(edges).toHaveLength(0);
  });

  it('handles markdown fences', async () => {
    const vlm = new FakeVLM(
      '```json\n[{"subject_id":"e1","relation":"using","object_id":"e2"}]\n```',
    );
    const edges = await new SemanticGraphBuilder(vlm).build(Buffer.from(''), entities);
    expect(edges).toHaveLength(1);
  });

  it('clamps semantic confidence and rejects malformed edge arrays', async () => {
    const high = new FakeVLM(
      '[{"subject_id":"e1","relation":"holding","object_id":"e2","confidence":9}]',
    );
    expect((await new SemanticGraphBuilder(high).build(Buffer.from(''), entities))[0]!.confidence)
      .toBe(1);
    const malformed = new FakeVLM(
      '[{"subject_id":"e1","relation":"holding","object_id":"e2","confidence":"high"}]',
    );
    expect(await new SemanticGraphBuilder(malformed).build(Buffer.from(''), entities)).toEqual([]);
  });
});
describe('Reasoner', () => {
  const entities = [entity('e1', 'button', [0, 0, 50, 20])];

  it('returns null without VLM', async () => {
    const r = new Reasoner(null);
    expect(await r.reason({ image: Buffer.from(''), entities, sceneGraph: { spatial: [], semantic: [] }, imageType: 'screen_ui' })).toBeNull();
  });

  it('parses valid reasoning', async () => {
    const vlm = new FakeVLM('{"summary":"A login screen","reasoning_confidence":0.9}');
    const out = await new Reasoner(vlm).reason({
      image: Buffer.from(''),
      entities,
      sceneGraph: { spatial: [], semantic: [] },
      imageType: 'screen_ui',
    });
    expect(out?.summary).toBe('A login screen');
    expect(out?.reasoningConfidence).toBe(0.9);
  });

  it('rejects invalid JSON rather than treating it as validated reasoning', async () => {
    const vlm = new FakeVLM('This shows a form.');
    const out = await new Reasoner(vlm).reason({
      image: Buffer.from(''),
      entities,
      sceneGraph: { spatial: [], semantic: [] },
      imageType: 'screen_ui',
    });
    expect(out).toBeNull();
  });

  it('parses fable-style thinking trace', async () => {
    const vlm = new FakeVLM(
      JSON.stringify({
        thinking_trace: [
          { phase: 'observe', content: 'A window with "Login" and "Password" fields.' },
          { phase: 'ground', content: '"Login" is OBSERVED; the button state is ASSUMED.' },
          { phase: 'hypothesize', content: 'H1: login screen. H2: signup screen.' },
          { phase: 'verify', content: '"Login" label discriminates: H1 wins.' },
          { phase: 'self_review', content: 'Button text might be truncated.' },
          { phase: 'deliver', content: 'This is a login screen.' },
        ],
        summary: 'A login screen',
        open_questions: ['Button enabled state not visible'],
        reasoning_confidence: 0.8,
      }),
    );
    const out = await new Reasoner(vlm).reason({
      image: Buffer.from(''),
      entities,
      sceneGraph: { spatial: [], semantic: [] },
      imageType: 'screen_ui',
    });
    expect(out?.thinkingTrace).toBeDefined();
    expect(out?.thinkingTrace).toHaveLength(6);
    expect(out?.thinkingTrace![0]!.phase).toBe('observe');
    expect(out?.thinkingTrace![3]!.phase).toBe('verify');
    expect(out?.openQuestions).toEqual(['Button enabled state not visible']);
  });

  it('rejects invalid thinking trace phases', async () => {
    const vlm = new FakeVLM(
      JSON.stringify({
        thinking_trace: [
          { phase: 'observe', content: 'valid step' },
          { phase: 'bogus_phase', content: 'should be dropped' },
          { phase: 'hypothesize', content: '' },
        ],
        summary: 'test',
      }),
    );
    const out = await new Reasoner(vlm).reason({
      image: Buffer.from(''),
      entities,
      sceneGraph: { spatial: [], semantic: [] },
      imageType: 'screen_ui',
    });
    expect(out).toBeNull();
  });

  it('clamps reasoning confidence and rejects malformed action hints', async () => {
    const clamped = await new Reasoner(new FakeVLM(
      '{"summary":"ok","reasoning_confidence":4}',
    )).reason({ image: Buffer.from(''), entities, sceneGraph: { spatial: [], semantic: [] }, imageType: 'screen_ui' });
    expect(clamped?.reasoningConfidence).toBe(1);
    const malformed = await new Reasoner(new FakeVLM(
      '{"summary":"bad","action_hints":[{"action":"click"}]}',
    )).reason({ image: Buffer.from(''), entities, sceneGraph: { spatial: [], semantic: [] }, imageType: 'screen_ui' });
    expect(malformed).toBeNull();
  });
});

describe('ModeRouter', () => {
  const classification = {
    type: 'document' as const,
    confidence: 0.9,
    classifierLayerUsed: 'test',
    characteristics: {
      hasUiElements: false, hasText: true, isPhoto: false, aspectRatio: 0.7, hasExif: false,
    },
  };

  it('auto routes a simple document to basic', () => {
    const selection = new ModeRouter().select(classification, 'auto');
    expect(selection.modeSelected).toBe('basic');
    expect(selection.reason).toBe('simple_document_text_extraction');
  });

  it.each([
    ['basic', false, false, false],
    ['standard', true, false, false],
    ['advanced', true, true, false],
    ['full', true, true, true],
  ] as const)('defines structured/semantic/reasoner policy for %s', (
    mode, structured, semantic, reasoner,
  ) => {
    const policy = ModeRouter.policyFor(mode);
    expect(policy.combinedStructuredFields).toBe(structured);
    expect(policy.semantic).toBe(semantic);
    expect(policy.reasoner).toBe(reasoner);
    expect(policy.pluginTypes).toEqual(mode === 'basic' ? ['ocr'] : ['ocr', 'detection', 'ui']);
  });
});

describe('SpatialGraphBuilder', () => {
  const thresholds = {
    thresholdX: 0.05,
    thresholdY: 0.05,
    nearThreshold: 0.15,
    overlapIouThreshold: 0.1,
  };

  it('detects left_of / right_of', () => {
    const left = entity('e1', 'a', [10, 100, 50, 140]);
    const right = entity('e2', 'b', [500, 100, 540, 140]);
    const edges = new SpatialGraphBuilder(1000, 1000, thresholds).build([left, right]);
    const rels = new Set(edges.map((e) => `${e.subjectId}:${e.relation}:${e.objectId}`));
    expect(rels.has('e1:left_of:e2')).toBe(true);
    expect(rels.has('e2:right_of:e1')).toBe(true);
  });

  it('detects contains', () => {
    const outer = entity('e1', 'container', [0, 0, 500, 500]);
    const inner = entity('e2', 'child', [100, 100, 200, 200]);
    const edges = new SpatialGraphBuilder(1000, 1000, thresholds).build([outer, inner]);
    const rels = new Set(edges.map((e) => `${e.subjectId}:${e.relation}:${e.objectId}`));
    expect(rels.has('e1:contains:e2')).toBe(true);
  });
});

describe('ImageProcessor SSRF protection', () => {
  const proc = new ImageProcessor();

  it('blocks localhost', async () => {
    await expect(proc.assertUrlSafe('http://localhost/x.jpg')).rejects.toThrow(/SSRF|blocked/);
  });

  it('blocks private IP', async () => {
    await expect(proc.assertUrlSafe('http://192.168.1.1/x.jpg')).rejects.toThrow(/SSRF|blocked/);
  });

  it('blocks loopback IP', async () => {
    await expect(proc.assertUrlSafe('http://127.0.0.1/x.jpg')).rejects.toThrow(/SSRF|blocked/);
  });

  it('rejects oversized URL responses before reading the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? String(11 * 1024 * 1024) : null) },
      body: {
        getReader: () => {
          throw new Error('body should not be read');
        },
      },
    } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(proc.load('http://93.184.216.34/x.jpg')).rejects.toThrow(/size limit/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

