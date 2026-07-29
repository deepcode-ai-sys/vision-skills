/**
 * Example: Add your own provider via the plugin system.
 *
 * Implement a class extending BasePlugin, return data in the shape the
 * normalizer understands (text_blocks / objects / ui_elements), and register
 * it. The orchestrator handles it like any built-in provider (fallback,
 * circuit breaker, parallel execution).
 *
 * Run: npx tsx examples/custom-plugin.ts
 */

import {
  VisionSkills,
  BasePlugin,
  type PluginType,
  type RequestContext,
} from 'vision-skills';

/**
 * A toy OCR provider. In reality you'd call your own API here.
 * Return { confidence, text_blocks: [{ text, bbox:[x1,y1,x2,y2], confidence }] }
 */
class MyCustomOCR extends BasePlugin {
  readonly name = 'my_custom_ocr';
  readonly pluginType: PluginType = 'ocr';
  readonly provider = 'my-company';
  override readonly costEstimate = 0.001;

  protected async run(
    _image: Buffer,
    _context: RequestContext,
  ): Promise<Record<string, unknown>> {
    // Call your own OCR API here and map its response to this shape:
    return {
      confidence: 0.9,
      text_blocks: [
        { text: 'Hello from custom OCR', bbox: [10, 10, 200, 40], confidence: 0.9 },
      ],
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

async function main() {
  // Use mock providers as base, then add our custom OCR (priority 0 = first)
  const vision = new VisionSkills({ useMockProviders: true });
  vision.registerPlugin(new MyCustomOCR(), 0);

  // A 1x1 transparent PNG as a tiny valid image
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );

  const result = await vision.analyze(tinyPng, { mode: 'basic' });
  console.log('Provider used:', result.providerResults.map((r) => r.plugin));
  console.log('Text entities:', result.entities.filter((e) => e.text).map((e) => e.text));
}

main().catch(console.error);
