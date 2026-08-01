import { describe, it, expect } from 'vitest';

import { geminiBoxToPixels, stripFences } from '../src/plugins/gemini/client.js';
import { parseCombined } from '../src/plugins/gemini/analyzer.js';

describe('Gemini box conversion', () => {
  it('converts [ymin,xmin,ymax,xmax] 0-1000 to pixels', () => {
    // ymin=100, xmin=200, ymax=500, xmax=600 on a 1000x800 image
    expect(geminiBoxToPixels([100, 200, 500, 600], 1000, 800)).toEqual([200, 80, 600, 400]);
  });

  it('handles empty box', () => {
    expect(geminiBoxToPixels([], 1000, 800)).toEqual([0, 0, 0, 0]);
  });

  it('clamps out-of-range and non-finite box values', () => {
    expect(geminiBoxToPixels([-100, Number.NaN, 1200, 2000], 1000, 800)).toEqual([
      0,
      0,
      1000,
      800,
    ]);
  });
});

describe('stripFences', () => {
  it('removes json code fences', () => {
    expect(stripFences('```json\n[1,2,3]\n```')).toBe('[1,2,3]');
  });
  it('leaves plain text alone', () => {
    expect(stripFences('[1,2,3]')).toBe('[1,2,3]');
  });
});

describe('parseCombined (OCR + detection in one response)', () => {
  it('parses both text blocks and objects', () => {
    const raw = JSON.stringify({
      text_blocks: [{ text: 'Xin chào', box_2d: [100, 200, 200, 600], language: 'vi' }],
      objects: [{ label: 'person', box_2d: [100, 100, 500, 300], confidence: 0.95 }],
    });
    const result = parseCombined(raw, 1000, 1000);
    expect(result.textBlocks).toHaveLength(1);
    expect(result.textBlocks[0]!.text).toBe('Xin chào');
    expect(result.textBlocks[0]!.language).toBe('vi');
    expect(result.textBlocks[0]!.bbox).toEqual([200, 100, 600, 200]);
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0]!.label).toBe('person');
    expect(result.objects[0]!.bbox).toEqual([100, 100, 300, 500]);
  });

  it('handles code-fenced output', () => {
    const raw = '```json\n{"text_blocks":[{"text":"Hi","box_2d":[0,0,100,100]}],"objects":[]}\n```';
    const result = parseCombined(raw, 500, 500);
    expect(result.textBlocks).toHaveLength(1);
    expect(result.objects).toHaveLength(0);
  });

  it('handles empty / invalid', () => {
    expect(parseCombined('not json', 100, 100).textBlocks).toHaveLength(0);
    expect(parseCombined('{}', 100, 100).objects).toHaveLength(0);
  });

  it('filters out empty text and labels', () => {
    const raw = JSON.stringify({
      text_blocks: [{ text: '  ', box_2d: [0, 0, 10, 10] }],
      objects: [{ label: '', box_2d: [0, 0, 10, 10] }],
    });
    const result = parseCombined(raw, 100, 100);
    expect(result.textBlocks).toHaveLength(0);
    expect(result.objects).toHaveLength(0);
  });

  it('defaults object confidence when missing', () => {
    const raw = JSON.stringify({
      text_blocks: [],
      objects: [{ label: 'dog', box_2d: [0, 0, 100, 100] }],
    });
    const result = parseCombined(raw, 100, 100);
    expect(result.objects[0]!.confidence).toBe(0.85);
  });

  it('clamps invalid confidence and orders reversed boxes', () => {
    const raw = JSON.stringify({
      text_blocks: [],
      objects: [{ label: 'dog', box_2d: [900, 800, 100, 200], confidence: 12 }],
    });
    const object = parseCombined(raw, 1000, 500).objects[0]!;
    expect(object.confidence).toBe(1);
    expect(object.bbox).toEqual([200, 50, 800, 450]);
  });

  it('rejects malformed combined output instead of partially trusting it', () => {
    const raw = JSON.stringify({
      text_blocks: [{ text: 'valid-looking', box_2d: ['bad', 0, 10, 10] }],
      objects: [],
    });
    expect(parseCombined(raw, 100, 100).textBlocks).toEqual([]);
  });

  it('preserves valid OCR and objects when optional fields and individual items are malformed', () => {
    const result = parseCombined(JSON.stringify({
      text_blocks: [
        { text: 'valid', box_2d: [0, 0, 100, 100] },
        { text: 'bad', box_2d: ['x', 0, 10, 10] },
      ],
      objects: [
        { label: 'person', box_2d: [0, 0, 200, 200], confidence: 0.7 },
        { label: 'bad', box_2d: null },
      ],
      tables: 'malformed', layout: { lighting: { brightness: 'bright' } },
    }), 1000, 500);
    expect(result.textBlocks.map((item) => item.text)).toEqual(['valid']);
    expect(result.objects.map((item) => item.label)).toEqual(['person']);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('text_blocks[1]'), expect.stringContaining('objects[1]'),
      expect.stringContaining('tables'), expect.stringContaining('layout'),
    ]));
  });

  it('tolerates missing arrays', () => {
    const result = parseCombined('{"text_blocks":[{"text":"A","box_2d":[0,0,50,50]}]}', 100, 100);
    expect(result.textBlocks).toHaveLength(1);
    expect(result.objects).toHaveLength(0);
    expect(result.tables).toHaveLength(0);
  });

  it('extracts structured tables', () => {
    const raw = JSON.stringify({
      text_blocks: [],
      objects: [],
      tables: [
        {
          title: 'RECENT REQUESTS',
          columns: ['Model', 'In / Out', 'When'],
          rows: [
            ['claude-opus', '574 / 140', '8s ago'],
            ['claude-opus', '514 / 419', '17s ago'],
          ],
          box_2d: [100, 200, 500, 800],
        },
      ],
    });
    const result = parseCombined(raw, 1000, 1000);
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]!.title).toBe('RECENT REQUESTS');
    expect(result.tables[0]!.columns).toEqual(['Model', 'In / Out', 'When']);
    expect(result.tables[0]!.rows).toHaveLength(2);
    expect(result.tables[0]!.rows[0]).toEqual(['claude-opus', '574 / 140', '8s ago']);
  });

  it('drops empty tables', () => {
    const raw = JSON.stringify({
      text_blocks: [],
      objects: [],
      tables: [{ title: 'empty', columns: [], rows: [] }],
    });
    expect(parseCombined(raw, 100, 100).tables).toHaveLength(0);
  });

  it('parses text color and emphasis (tier 4)', () => {
    const raw = JSON.stringify({
      text_blocks: [
        { text: 'Build failed', box_2d: [0, 0, 50, 200], color: '#ff3333', emphasis: 'error' },
      ],
      objects: [],
    });
    const result = parseCombined(raw, 500, 500);
    expect(result.textBlocks[0]!.color).toBe('#ff3333');
    expect(result.textBlocks[0]!.emphasis).toBe('error');
  });

  it('parses code info (tier 6)', () => {
    const raw = JSON.stringify({
      text_blocks: [],
      objects: [],
      code: {
        language: 'python',
        functions: ['render_video', 'main'],
        errors: ['TypeError: x'],
        snippet: 'def render_video():',
      },
    });
    const result = parseCombined(raw, 500, 500);
    expect(result.code).not.toBeNull();
    expect(result.code!.language).toBe('python');
    expect(result.code!.functions).toEqual(['render_video', 'main']);
    expect(result.code!.errors).toEqual(['TypeError: x']);
  });

  it('code is null when not code content', () => {
    const raw = JSON.stringify({ text_blocks: [], objects: [], code: null });
    expect(parseCombined(raw, 100, 100).code).toBeNull();
  });

  it('code is null when code object is empty', () => {
    const raw = JSON.stringify({
      text_blocks: [],
      objects: [],
      code: { language: null, functions: [], errors: [], snippet: null },
    });
    expect(parseCombined(raw, 100, 100).code).toBeNull();
  });
});
