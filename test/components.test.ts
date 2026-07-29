import { describe, it, expect } from 'vitest';

import { GoogleVisionOCRPlugin } from '../src/plugins/ocr/google-vision.js';
import { GoogleVisionDetectionPlugin } from '../src/plugins/detection/google-vision.js';
import { SemanticGraphBuilder, type VLMClient } from '../src/scene-graph/semantic.js';
import { Reasoner } from '../src/reasoner/reasoner.js';
import { SpatialGraphBuilder } from '../src/scene-graph/spatial.js';
import { ImageProcessor } from '../src/utils/image.js';
import { BoundingBox, type Entity } from '../src/core/types.js';

describe('GoogleVisionOCRPlugin.parse', () => {
  const plugin = new GoogleVisionOCRPlugin('test-key');

  it('parses fullTextAnnotation', () => {
    const parsed = plugin.parse({
      responses: [
        {
          fullTextAnnotation: {
            text: 'Hello',
            pages: [
              {
                blocks: [
                  {
                    confidence: 0.98,
                    boundingBox: {
                      vertices: [
                        { x: 0, y: 0 },
                        { x: 100, y: 0 },
                        { x: 100, y: 30 },
                        { x: 0, y: 30 },
                      ],
                    },
                    paragraphs: [{ words: [{ symbols: [{ text: 'H' }, { text: 'i' }] }] }],
                  },
                ],
              },
            ],
          },
        },
      ],
    });
    const blocks = parsed.text_blocks as Array<Record<string, unknown>>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toBe('Hi');
    expect(blocks[0]!.bbox).toEqual([0, 0, 100, 30]);
  });

  it('throws on error response', () => {
    expect(() => plugin.parse({ responses: [{ error: { message: 'bad' } }] })).toThrow('bad');
  });

  it('handles empty response', () => {
    const parsed = plugin.parse({ responses: [{}] });
    expect(parsed.text_blocks).toEqual([]);
  });
});

describe('GoogleVisionDetectionPlugin.parse', () => {
  const plugin = new GoogleVisionDetectionPlugin('test-key');

  it('converts normalized vertices to pixels', () => {
    const parsed = plugin.parse(
      {
        responses: [
          {
            localizedObjectAnnotations: [
              {
                name: 'Person',
                score: 0.95,
                boundingPoly: {
                  normalizedVertices: [
                    { x: 0.1, y: 0.1 },
                    { x: 0.3, y: 0.1 },
                    { x: 0.3, y: 0.5 },
                    { x: 0.1, y: 0.5 },
                  ],
                },
              },
            ],
          },
        ],
      },
      1000,
      800,
    );
    const objects = parsed.objects as Array<Record<string, unknown>>;
    expect(objects[0]!.label).toBe('Person');
    expect(objects[0]!.bbox).toEqual([100, 80, 300, 400]);
  });
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
});

describe('Reasoner', () => {
  const entities = [entity('e1', 'button', [0, 0, 50, 20])];

  it('returns null without VLM', async () => {
    const r = new Reasoner(null);
    expect(await r.reason(Buffer.from(''), entities, { spatial: [], semantic: [] }, 'screen_ui')).toBeNull();
  });

  it('parses valid reasoning', async () => {
    const vlm = new FakeVLM('{"summary":"A login screen","reasoning_confidence":0.9}');
    const out = await new Reasoner(vlm).reason(
      Buffer.from(''),
      entities,
      { spatial: [], semantic: [] },
      'screen_ui',
    );
    expect(out?.summary).toBe('A login screen');
    expect(out?.reasoningConfidence).toBe(0.9);
  });

  it('falls back to raw text on invalid JSON', async () => {
    const vlm = new FakeVLM('This shows a form.');
    const out = await new Reasoner(vlm).reason(
      Buffer.from(''),
      entities,
      { spatial: [], semantic: [] },
      'screen_ui',
    );
    expect(out?.summary).toContain('form');
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
});
