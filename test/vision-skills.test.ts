import { describe, it, expect } from 'vitest';
import sharp from 'sharp';

import { VisionSkills } from '../src/vision-skills.js';
import { BoundingBox } from '../src/core/types.js';

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
  it('analyzes an image end-to-end in standard mode', async () => {
    const vision = new VisionSkills({ useMockProviders: true, cacheEnabled: false });
    const img = await makeImage();
    const result = await vision.analyze(img, { mode: 'standard' });

    expect(result.schemaVersion).toBe('3.1.0');
    expect(result.modeUsed).toBe('standard');
    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.providerResults.length).toBeGreaterThan(0);
    expect(result.latencyMsTotal).toBeGreaterThan(0);
  });

  it('basic mode runs OCR only', async () => {
    const vision = new VisionSkills({ useMockProviders: true, cacheEnabled: false });
    const img = await makeImage();
    const result = await vision.analyze(img, { mode: 'basic' });

    expect(result.modeUsed).toBe('basic');
    expect(result.providerResults).toHaveLength(1);
    expect(result.providerResults[0]!.plugin).toBe('mock_ocr');
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

  it('rejects invalid image bytes', async () => {
    const vision = new VisionSkills({ useMockProviders: true });
    await expect(vision.analyze(Buffer.from('not an image'))).rejects.toThrow();
  });
});
