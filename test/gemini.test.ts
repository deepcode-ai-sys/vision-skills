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
});
