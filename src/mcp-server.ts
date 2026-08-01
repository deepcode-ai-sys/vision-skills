#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { VisionSkills, type AnalyzeOptions } from './vision-skills.js';
import type { VisionSkillsConfig } from './config.js';
import { REQUESTED_MODES, type RequestedMode } from './core/types.js';
import { boundOutput, boundedLegacyText } from './utils/output.js';

const DEFAULT_MAX_OUTPUT_CHARS = 200_000;
const DEFAULT_MAX_CLIPBOARD_BYTES = 10 * 1024 * 1024;
const imageSchema = z.string().min(1).max(15_000_000).describe('Image path, URL, base64, or image data URI');
const modeSchema = z.enum(REQUESTED_MODES).optional();

type VisionService = Pick<VisionSkills, 'analyze' | 'healthCheck'>;

export interface McpServerOptions {
  vision?: VisionService;
  config?: VisionSkillsConfig;
  maxOutputChars?: number;
  maxClipboardBytes?: number;
  readClipboardImage?: () => Buffer;
}

function normalizeImage(image: string): string {
  if (/^(?:https?:\/\/|data:image\/)/.test(image)) return image;
  if (existsSync(image)) return image;
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(image) && image.length % 4 === 0) {
    return `data:image/png;base64,${image}`;
  }
  return image;
}

function textSummary(result: Awaited<ReturnType<VisionService['analyze']>>): string {
  const texts = result.entities.filter((entity) => entity.text).map((entity) => entity.text).join(' | ');
  const objects = [...new Set(result.entities.map((entity) => entity.label))].join(', ');
  return [
    `Image type: ${result.imageType}`,
    texts ? `Text: ${texts}` : null,
    objects ? `Objects: ${objects}` : null,
    result.reasonerOutput ? `Summary: ${result.reasonerOutput.summary}` : null,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true as const,
    structuredContent: { error: { message } },
    content: [{ type: 'text' as const, text: message }],
  };
}

export function createMcpServer(options: McpServerOptions = {}): McpServer {
  const vision = options.vision ?? new VisionSkills(options.config);
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const maxClipboardBytes = options.maxClipboardBytes ?? DEFAULT_MAX_CLIPBOARD_BYTES;
  if (!Number.isSafeInteger(maxOutputChars) || maxOutputChars < 0) throw new RangeError('maxOutputChars must be a non-negative safe integer');
  if (!Number.isSafeInteger(maxClipboardBytes) || maxClipboardBytes < 1) throw new RangeError('maxClipboardBytes must be a positive safe integer');
  const server = new McpServer({ name: 'vision-skills-mcp', version: '0.1.0' });

  const analyze = async (
    args: { image: string; mode?: RequestedMode; depth?: 'fast' | 'deep' },
    extra: { signal: AbortSignal; _meta?: { progressToken?: string | number }; sendNotification: (notification: never) => Promise<void> },
    plainText: boolean,
  ) => {
    try {
      const reportProgress: AnalyzeOptions['reportProgress'] = async (progress, message) => {
        const progressToken = extra._meta?.progressToken;
        if (progressToken === undefined) return;
        await extra.sendNotification({
          method: 'notifications/progress',
          params: { progressToken, progress, total: 100, message },
        } as never);
      };
      await reportProgress(1, 'Starting analysis');
      const result = await vision.analyze(normalizeImage(args.image), {
        mode: args.mode,
        analysisDepth: args.depth,
        signal: extra.signal,
        reportProgress,
      });
      await reportProgress(100, 'Analysis complete');
      const output = boundOutput(plainText ? textSummary(result) : result, maxOutputChars);
      return {
        structuredContent: output as unknown as Record<string, unknown>,
        content: [{ type: 'text' as const, text: plainText && output.data !== undefined
          ? String(output.data)
          : boundedLegacyText(output) }],
      };
    } catch (error) {
      return toolError(error);
    }
  };

  server.registerTool('analyze', {
    description: 'Analyze an image and return bounded structured output',
    inputSchema: z.object({
      image: imageSchema,
      mode: modeSchema,
      depth: z.enum(['fast', 'deep']).default('fast'),
    }).strict(),
  }, (args, extra) => analyze(args, extra, false));

  server.registerTool('analyze_text', {
    description: 'Analyze an image and return a bounded plain-text summary',
    inputSchema: z.object({ image: imageSchema, mode: modeSchema }).strict(),
  }, (args, extra) => analyze(args, extra, true));

  server.registerTool('health', {
    description: 'Check provider readiness',
    inputSchema: z.object({}).strict(),
  }, async () => {
    try {
      const providers = await vision.healthCheck();
      const output = boundOutput({ ready: Object.values(providers).some(Boolean), providers }, maxOutputChars);
      return { structuredContent: output as unknown as Record<string, unknown>, content: [{ type: 'text', text: boundedLegacyText(output) }] };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('clipboard', {
    description: 'Read a PNG image from the Windows system clipboard',
    inputSchema: z.object({}).strict(),
  }, async () => {
    try {
      let image: Buffer;
      if (options.readClipboardImage) image = options.readClipboardImage();
      else {
        if (process.platform !== 'win32') throw new Error('Clipboard tool is supported on Windows only');
        const script = `Add-Type -AssemblyName System.Windows.Forms;$i=[System.Windows.Forms.Clipboard]::GetImage();if($null -eq $i){throw "No image in clipboard"};$m=New-Object IO.MemoryStream;$i.Save($m,[Drawing.Imaging.ImageFormat]::Png);$b=$m.ToArray();if($b.Length -gt ${maxClipboardBytes}){throw "Clipboard image is $($b.Length) bytes; maximum is ${maxClipboardBytes} bytes"};[Console]::OpenStandardOutput().Write($b,0,$b.Length)`;
        image = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
          timeout: 10_000, maxBuffer: maxClipboardBytes + 1,
        });
      }
      if (image.length > maxClipboardBytes) {
        throw new Error(`Clipboard image is ${image.length} bytes; maximum is ${maxClipboardBytes} bytes`);
      }
      return {
        structuredContent: { format: 'png', bytes: image.length },
        content: [{ type: 'image' as const, data: image.toString('base64'), mimeType: 'image/png' }],
      };
    } catch (error) {
      return toolError(error);
    }
  });

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createMcpServer();
  const shutdown = async () => {
    await server.close();
    process.exitCode = 0;
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMcpServer().catch((error) => {
    console.error('MCP server error:', error);
    process.exitCode = 1;
  });
}
