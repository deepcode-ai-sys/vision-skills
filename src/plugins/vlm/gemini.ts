/**
 * Gemini VLM client (FREE tier).
 *
 * Implements the VLMClient interface for the semantic scene graph builder
 * and reasoner. Free at Google AI Studio.
 */

import { ProviderError } from '../../core/errors.js';
import type { VLMClient } from '../../scene-graph/semantic.js';
import { callGemini } from '../gemini/client.js';

export class GeminiVLMClient implements VLMClient {
  constructor(
    private apiKey?: string,
    private model = 'gemini-2.0-flash',
  ) {}

  get available(): boolean {
    return Boolean(this.apiKey);
  }

  async askJson(image: Buffer, prompt: string, _maxTokens = 1024): Promise<string> {
    if (!this.apiKey) {
      throw new ProviderError('Gemini API key not configured', 'gemini');
    }
    return callGemini({
      apiKey: this.apiKey,
      model: this.model,
      prompt,
      imageBase64: image.toString('base64'),
      jsonOutput: true,
    });
  }

  async healthCheck(): Promise<boolean> {
    return Boolean(this.apiKey);
  }
}
