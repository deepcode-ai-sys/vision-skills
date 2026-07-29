/**
 * Gemini VLM client (FREE tier).
 *
 * Implements the VLMClient interface for the semantic scene graph builder
 * and reasoner. Free at Google AI Studio. Uses a key pool for rotation.
 */

import type { VLMClient } from '../../scene-graph/semantic.js';
import { callGemini } from '../gemini/client.js';
import { GeminiKeyPool } from '../gemini/key-pool.js';

export class GeminiVLMClient implements VLMClient {
  private keyPool: GeminiKeyPool;

  constructor(
    keys: string | string[] | GeminiKeyPool | undefined,
    private model = 'gemini-flash-lite-latest',
  ) {
    this.keyPool =
      keys instanceof GeminiKeyPool
        ? keys
        : new GeminiKeyPool(typeof keys === 'string' ? [keys] : (keys ?? []));
  }

  get available(): boolean {
    return this.keyPool.hasKeys;
  }

  async askJson(image: Buffer, prompt: string, _maxTokens = 1024): Promise<string> {
    return callGemini({
      keyPool: this.keyPool,
      model: this.model,
      prompt,
      imageBase64: image.toString('base64'),
      timeoutMs: 30000,
      jsonOutput: true,
    });
  }

  async healthCheck(): Promise<boolean> {
    return this.keyPool.hasKeys;
  }
}
