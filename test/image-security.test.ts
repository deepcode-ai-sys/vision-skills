import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { ImageProcessor } from '../src/utils/image.js';

describe('image security', () => {
  const processor = new ImageProcessor(1, 2048, 85, 100);

  it('rejects malformed base64 before decoding', async () => {
    await expect(processor.load('data:image/png;base64,not_base64!')).rejects.toThrow('Invalid base64');
  });

  it.each([
    'http://user:pass@example.com/a.png',
    'http://example.com:8080/a.png',
    'http://127.0.0.1/a.png',
    'http://100.64.0.1/a.png',
    'http://192.0.2.1/a.png',
    'http://[::ffff:127.0.0.1]/a.png',
  ])('rejects unsafe URL %s', async (url) => {
    await expect(processor.assertUrlSafe(url)).rejects.toThrow();
  });

  it('enforces decoded pixel limits', async () => {
    const image = await sharp({ create: { width: 11, height: 10, channels: 3, background: 'white' } }).png().toBuffer();
    await expect(processor.preprocess(image)).rejects.toThrow();
  });

  it('honors caller cancellation', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(processor.load(Buffer.from('x'), controller.signal)).rejects.toThrow('cancelled');
  });
});
