/**
 * Claude Vision VLM client.
 *
 * Implements the VLMClient interface used by the semantic scene graph
 * builder and reasoner. Uses the Anthropic Messages API via fetch.
 */

import { ProviderError } from '../../core/errors.js';
import type { VLMClient } from '../../scene-graph/semantic.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

export class ClaudeVLMClient implements VLMClient {
  constructor(
    private apiKey?: string,
    private model = 'claude-3-5-sonnet-20241022',
  ) {}

  get available(): boolean {
    return Boolean(this.apiKey);
  }

  async askJson(image: Buffer, prompt: string, maxTokens = 1024): Promise<string> {
    if (!this.apiKey) {
      throw new ProviderError('Anthropic API key not configured', 'claude-vision');
    }

    const payload = {
      model: this.model,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: image.toString('base64'),
              },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    };

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': API_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ProviderError(
        `Claude returned HTTP ${response.status}: ${body.slice(0, 200)}`,
        'claude-vision',
      );
    }

    const result = (await response.json()) as Record<string, unknown>;
    return this.extractText(result);
  }

  private extractText(result: Record<string, unknown>): string {
    const content = (result.content as Record<string, unknown>[]) ?? [];
    for (const block of content) {
      if (block.type === 'text') {
        return (block.text as string) ?? '';
      }
    }
    return '';
  }

  async healthCheck(): Promise<boolean> {
    return Boolean(this.apiKey);
  }
}
