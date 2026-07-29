/**
 * Mock plugins for testing without real API calls.
 */

import { BasePlugin } from './base.js';
import type { PluginType, RequestContext } from '../core/types.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockOCRPlugin extends BasePlugin {
  readonly name = 'mock_ocr';
  readonly pluginType: PluginType = 'ocr';
  readonly provider = 'mock';
  override readonly costEstimate = 0.002;

  protected async run(
    _image: Buffer,
    _context: RequestContext,
  ): Promise<Record<string, unknown>> {
    await delay(10);
    return {
      confidence: 0.95,
      text_blocks: [
        { text: 'Login', bbox: [120, 340, 180, 370], confidence: 0.98, language: 'en' },
        { text: 'Username', bbox: [100, 200, 200, 230], confidence: 0.97, language: 'en' },
      ],
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

export class MockDetectionPlugin extends BasePlugin {
  readonly name = 'mock_detection';
  readonly pluginType: PluginType = 'detection';
  readonly provider = 'mock';
  override readonly costEstimate = 0.005;

  protected async run(
    _image: Buffer,
    _context: RequestContext,
  ): Promise<Record<string, unknown>> {
    await delay(10);
    return {
      confidence: 0.92,
      objects: [
        { label: 'person', bbox: [120, 340, 240, 580], confidence: 0.95 },
        { label: 'bicycle', bbox: [300, 400, 450, 600], confidence: 0.9 },
      ],
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

export class MockUIPlugin extends BasePlugin {
  readonly name = 'mock_ui';
  readonly pluginType: PluginType = 'ui';
  readonly provider = 'mock';
  override readonly costEstimate = 0;

  protected async run(
    _image: Buffer,
    _context: RequestContext,
  ): Promise<Record<string, unknown>> {
    await delay(5);
    return {
      confidence: 0.6,
      ui_elements: [
        {
          label: 'button',
          element_type: 'button',
          bbox: [100, 400, 250, 440],
          confidence: 0.6,
          clickable: true,
        },
      ],
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
