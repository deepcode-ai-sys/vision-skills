import { z } from 'zod';

import {
  bboxSchema,
  canonicalV1Schema,
  emptyCanonicalOutput,
  type SpecialistCanonicalOutput,
  type SpecialistCapability,
  type SpecialistProtocol,
} from './types.js';

export interface SpecialistCodec {
  readonly protocol: SpecialistProtocol;
  encode(image: Buffer, capabilities: SpecialistCapability[], model?: string): unknown;
  decode(value: unknown, imageSize?: { width: number; height: number }): SpecialistCanonicalOutput;
}

function pointsToBox(points: Array<[number, number]>): [number, number, number, number] {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const paddleObjectSchema = z.object({
  result: z.array(z.array(z.object({
    text: z.string(), confidence: z.number().min(0).max(1).finite().optional(),
    text_region: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(2),
  }).strict())),
}).strict();
const paddleTupleSchema = z.object({
  result: z.array(z.array(z.tuple([
    z.array(z.tuple([z.number().finite(), z.number().finite()])).min(2),
    z.tuple([z.string(), z.number().min(0).max(1).finite().nullable()]),
  ]))),
}).strict();
const paddleDirectTupleSchema = z.array(z.array(z.tuple([
  z.array(z.tuple([z.number().finite(), z.number().finite()])).min(2),
  z.tuple([z.string(), z.number().min(0).max(1).finite().nullable()]),
])));

export class CanonicalV1Codec implements SpecialistCodec {
  readonly protocol = 'canonical-v1' as const;
  encode(image: Buffer, capabilities: SpecialistCapability[]): unknown {
    return { protocol: this.protocol, image: image.toString('base64'), capabilities };
  }
  decode(value: unknown): SpecialistCanonicalOutput {
    return canonicalV1Schema.parse(value);
  }
}

export class PaddleOcrClassicCodec implements SpecialistCodec {
  readonly protocol = 'paddleocr-classic' as const;
  encode(image: Buffer): unknown { return { image: image.toString('base64') }; }
  decode(value: unknown): SpecialistCanonicalOutput {
    const output = emptyCanonicalOutput();
    const objectResult = paddleObjectSchema.safeParse(value);
    if (objectResult.success) {
      output.text = objectResult.data.result.flat().map((item) => ({
        text: item.text, bbox: pointsToBox(item.text_region), confidence: item.confidence ?? null,
      }));
      return output;
    }
    const tupleResult = paddleTupleSchema.safeParse(value);
    if (tupleResult.success) {
      output.text = tupleResult.data.result.flat().map(([points, recognition]) => ({
        text: recognition[0], bbox: pointsToBox(points), confidence: recognition[1],
      }));
      return output;
    }
    const directResult = paddleDirectTupleSchema.safeParse(value);
    if (directResult.success) {
      output.text = directResult.data.flat().map(([points, recognition]) => ({
        text: recognition[0], bbox: pointsToBox(points), confidence: recognition[1],
      }));
      return output;
    }
    throw new Error('Unknown paddleocr-classic response shape');
  }
}

const doclingSchema = z.object({
  schema_name: z.literal('DoclingDocument'),
  version: z.string(),
  texts: z.array(z.object({
    self_ref: z.string(), label: z.string(), text: z.string(),
    prov: z.array(z.object({
      page_no: z.number().int().nonnegative(),
      bbox: z.object({ l: z.number(), t: z.number(), r: z.number(), b: z.number(), coord_origin: z.string() }).passthrough(),
    }).passthrough()),
  }).passthrough()),
  tables: z.array(z.object({
    label: z.string(),
    data: z.object({ grid: z.array(z.array(z.object({ text: z.string() }).passthrough())) }).passthrough(),
    prov: z.array(z.object({
      page_no: z.number().int().nonnegative(),
      bbox: z.object({ l: z.number(), t: z.number(), r: z.number(), b: z.number(), coord_origin: z.string() }).passthrough(),
    }).passthrough()),
  }).passthrough()).default([]),
}).passthrough();

function doclingBox(box: { l: number; t: number; r: number; b: number }): [number, number, number, number] {
  return [Math.min(box.l, box.r), Math.min(box.t, box.b), Math.max(box.l, box.r), Math.max(box.t, box.b)];
}

export class DoclingJsonCodec implements SpecialistCodec {
  readonly protocol = 'docling-json' as const;
  encode(image: Buffer): unknown { return { document: image.toString('base64') }; }
  decode(value: unknown): SpecialistCanonicalOutput {
    const parsed = doclingSchema.safeParse(value);
    if (!parsed.success) throw new Error('Unknown docling-json response shape');
    const output = emptyCanonicalOutput();
    output.text = parsed.data.texts.map((item) => ({
      text: item.text,
      bbox: item.prov[0] ? doclingBox(item.prov[0].bbox) : [0, 0, 0, 0],
      confidence: null,
    }));
    output.tables = parsed.data.tables.map((item) => {
      const rows = item.data.grid.map((row) => row.map((cell) => cell.text));
      const box = item.prov[0] ? doclingBox(item.prov[0].bbox) : undefined;
      return {
        title: item.label || null,
        columns: rows.shift() ?? [],
        rows,
        bbox: box,
      };
    });
    return output;
  }
}

const omniSchema = z.object({
  som_image_base64: z.string().optional(),
  parsed_content_list: z.array(z.object({
    type: z.string().min(1), content: z.string().default(''), bbox: bboxSchema,
    interactivity: z.boolean().optional(), confidence: z.number().min(0).max(1).finite().nullable().optional(),
  }).strict()),
}).strict();

export class OmniParserV2Codec implements SpecialistCodec {
  readonly protocol = 'omniparser-v2' as const;
  encode(image: Buffer): unknown { return { base64_image: image.toString('base64') }; }
  decode(value: unknown, imageSize?: { width: number; height: number }): SpecialistCanonicalOutput {
    const parsed = omniSchema.safeParse(value);
    if (!parsed.success) throw new Error('Unknown omniparser-v2 response shape');
    const output = emptyCanonicalOutput();
    if (!imageSize) throw new Error('OmniParser ratio bbox requires image dimensions');
    output.ui = parsed.data.parsed_content_list.map((item) => {
      const clampRatio = (coordinate: number): number => Math.min(1, Math.max(0, coordinate));
      const [rawX1, rawY1, rawX2, rawY2] = item.bbox;
      const x1 = clampRatio(Math.min(rawX1, rawX2));
      const y1 = clampRatio(Math.min(rawY1, rawY2));
      const x2 = clampRatio(Math.max(rawX1, rawX2));
      const y2 = clampRatio(Math.max(rawY1, rawY2));
      return {
        label: item.type, text: item.content || null,
        bbox: [x1 * imageSize.width, y1 * imageSize.height,
          x2 * imageSize.width, y2 * imageSize.height] as [number, number, number, number],
        clickable: item.interactivity ?? null, confidence: item.confidence ?? null,
      };
    });
    return output;
  }
}

const openAiSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())]) }).passthrough(),
  }).passthrough()).min(1),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), total_tokens: z.number().optional() }).passthrough().optional(),
}).passthrough();

export class OpenAiChatCompletionsCodec implements SpecialistCodec {
  readonly protocol = 'openai-chat-completions' as const;
  encode(image: Buffer, capabilities: SpecialistCapability[], model?: string): unknown {
    if (!model) throw new Error('openai-chat-completions requires a model');
    return {
      model,
      messages: [{ role: 'user', content: [
        { type: 'text', text: `Return strict canonical-v1 JSON for capabilities: ${capabilities.join(', ')}. Missing confidence must be null.` },
        { type: 'image_url', image_url: { url: `data:${imageMimeType(image)};base64,${image.toString('base64')}` } },
      ] }],
      temperature: 0,
      response_format: { type: 'json_object' },
    };
  }
  decode(value: unknown): SpecialistCanonicalOutput {
    const parsed = openAiSchema.safeParse(value);
    if (!parsed.success) throw new Error('Unknown openai-chat-completions response shape');
    const content = parsed.data.choices[0]!.message.content;
    const text = typeof content === 'string'
      ? content
      : content.map((part) => part.text ?? '').join('');
    let json: unknown;
    try { json = JSON.parse(text); } catch { throw new Error('openai-chat-completions content is not JSON'); }
    return canonicalV1Schema.parse(json);
  }
}

function imageMimeType(image: Buffer): 'image/png' | 'image/jpeg' {
  return image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ? 'image/png'
    : 'image/jpeg';
}

export function createSpecialistCodec(protocol: SpecialistProtocol): SpecialistCodec {
  switch (protocol) {
    case 'canonical-v1': return new CanonicalV1Codec();
    case 'paddleocr-classic': return new PaddleOcrClassicCodec();
    case 'docling-json': return new DoclingJsonCodec();
    case 'omniparser-v2': return new OmniParserV2Codec();
    case 'openai-chat-completions': return new OpenAiChatCompletionsCodec();
  }
}
