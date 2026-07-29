import { describe, it, expect } from 'vitest';

import { GeminiOCRPlugin } from '../src/plugins/ocr/gemini.js';
import { GeminiDetectionPlugin } from '../src/plugins/detection/gemini.js';
import { geminiBoxToPixels, stripFences } from '../src/plugins/gemini/client.js';

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

describe('GeminiOCRPlugin.parse', () => {
  const plugin = new GeminiOCRPlugin('test-key');

  it('parses text blocks with boxes', () => {
    const raw = JSON.stringify([
      { text: 'Xin chào', box_2d: [100, 200, 200, 600], language: 'vi' },
    ]);
    const parsed = plugin.parse(raw, 1000, 1000);
    const blocks = parsed.text_blocks as Array<Record<string, unknown>>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toBe('Xin chào');
    expect(blocks[0]!.language).toBe('vi');
    expect(blocks[0]!.bbox).toEqual([200, 100, 600, 200]);
    expect(parsed.full_text).toBe('Xin chào');
  });

  it('handles code-fenced output', () => {
    const raw = '```json\n[{"text":"Hi","box_2d":[0,0,100,100]}]\n```';
    const parsed = plugin.parse(raw, 500, 500);
    expect((parsed.text_blocks as unknown[]).length).toBe(1);
  });

  it('handles empty / invalid', () => {
    expect((plugin.parse('not json', 100, 100).text_blocks as unknown[]).length).toBe(0);
    expect((plugin.parse('[]', 100, 100).text_blocks as unknown[]).length).toBe(0);
  });

  it('filters out empty text', () => {
    const raw = JSON.stringify([{ text: '  ', box_2d: [0, 0, 10, 10] }]);
    expect((plugin.parse(raw, 100, 100).text_blocks as unknown[]).length).toBe(0);
  });
});

describe('GeminiDetectionPlugin.parse', () => {
  const plugin = new GeminiDetectionPlugin('test-key');

  it('parses objects with boxes', () => {
    const raw = JSON.stringify([
      { label: 'person', box_2d: [100, 100, 500, 300], confidence: 0.95 },
      { label: 'car', box_2d: [200, 400, 600, 800], confidence: 0.88 },
    ]);
    const parsed = plugin.parse(raw, 1000, 1000);
    const objects = parsed.objects as Array<Record<string, unknown>>;
    expect(objects).toHaveLength(2);
    expect(objects[0]!.label).toBe('person');
    expect(objects[0]!.bbox).toEqual([100, 100, 300, 500]);
    expect(parsed.confidence).toBeCloseTo(0.915, 2);
  });

  it('handles empty', () => {
    expect((plugin.parse('[]', 100, 100).objects as unknown[]).length).toBe(0);
  });

  it('defaults confidence when missing', () => {
    const raw = JSON.stringify([{ label: 'dog', box_2d: [0, 0, 100, 100] }]);
    const objects = plugin.parse(raw, 100, 100).objects as Array<Record<string, unknown>>;
    expect(objects[0]!.confidence).toBe(0.85);
  });
});
