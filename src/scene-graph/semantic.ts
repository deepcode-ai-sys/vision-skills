/**
 * Semantic relationship builder (VLM-backed).
 *
 * Uses a VLM to infer semantic relations between already-detected entities.
 * Runs only in Advanced/Full modes. The VLM may only reference existing
 * entity IDs and use the fixed relation taxonomy.
 */

import { z } from 'zod';

import {
  allowedSemanticRelations,
  type Entity,
  type ImageType,
  type SemanticRelationEdge,
  type RequestContext,
} from '../core/types.js';

/** A VLM client that can answer a prompt about an image, returning text. */
export interface VLMClient {
  askJson(
    image: Buffer,
    prompt: string,
    maxTokens?: number,
    context?: RequestContext,
  ): Promise<string>;
}

const semanticEdgesSchema = z.array(z.object({
  subject_id: z.string().min(1),
  relation: z.string().min(1),
  object_id: z.string().min(1),
  confidence: z.number().finite().optional().default(0.7),
}));

export class SemanticGraphBuilder {
  constructor(private vlm: VLMClient | null) {}

  async build(
    image: Buffer,
    entities: Entity[],
    imageType: ImageType = 'mixed',
    context?: RequestContext,
  ): Promise<SemanticRelationEdge[]> {
    if (!this.vlm || entities.length < 2) return [];
    context?.signal?.throwIfAborted();

    const allowed = allowedSemanticRelations(imageType);
    const prompt = this.buildPrompt(entities, allowed, imageType);
    let raw: string;
    try {
      raw = await this.vlm.askJson(image, prompt, undefined, context);
    } catch (error) {
      if (context?.signal?.aborted) throw error;
      return [];
    }
    return this.parseEdges(raw, entities, allowed);
  }

  private buildPrompt(
    entities: Entity[],
    allowed: ReadonlySet<string>,
    imageType: ImageType,
  ): string {
    const lines = entities
      .map(
        (e) =>
          `  - id="${e.entityId}", label="${e.label}", bbox=[${e.bbox
            .toList()
            .join(',')}]`,
      )
      .join('\n');
    const relations = [...allowed].sort().join(', ');
    const example =
      imageType === 'real_world'
        ? '[{"subject_id": "e1", "relation": "holding", "object_id": "e3", "confidence": 0.9}]'
        : '[{"subject_id": "e1", "relation": "labels", "object_id": "e3", "confidence": 0.9}]';
    const guidance =
      imageType === 'real_world'
        ? 'These are physical relationships between real-world objects/people.'
        : 'These are UI/document relationships. For example: a container ' +
          '"contains" its children; a label "labels" an input; a button ' +
          '"submits" a form; text is "part_of" the element it sits inside.';
    return (
      'You are analyzing an image. Below is a list of entities already ' +
      'detected, each with an ID, label, and bounding box [x1,y1,x2,y2]:\n\n' +
      `${lines}\n\n` +
      'Identify SEMANTIC relationships between these entities based on what ' +
      `you see in the image. ${guidance}\n` +
      `You may ONLY use these relation types: ${relations}.\n` +
      'You may ONLY reference the entity IDs listed above - do not invent ' +
      'new objects.\n\n' +
      'Respond with ONLY a JSON array (no markdown, no explanation) of ' +
      'objects with this exact shape:\n' +
      `${example}\n` +
      'If there are no clear semantic relationships, respond with [].'
    );
  }

  private parseEdges(
    raw: string,
    entities: Entity[],
    allowed: ReadonlySet<string>,
  ): SemanticRelationEdge[] {
    const validIds = new Set(entities.map((e) => e.entityId));
    const text = this.stripFences(raw);

    let data: z.infer<typeof semanticEdgesSchema>;
    try {
      data = semanticEdgesSchema.parse(JSON.parse(text));
    } catch {
      return [];
    }

    const edges: SemanticRelationEdge[] = [];
    for (const item of data) {
      const subjectId = item.subject_id;
      const relation = item.relation;
      const objectId = item.object_id;

      if (!validIds.has(subjectId) || !validIds.has(objectId)) continue;
      if (!allowed.has(relation)) continue;
      if (subjectId === objectId) continue;

      edges.push({
        subjectId,
        relation,
        objectId,
        confidence: Math.min(1, Math.max(0, item.confidence)),
      });
    }
    return edges;
  }

  private stripFences(raw: string): string {
    let text = raw.trim();
    if (text.startsWith('```')) {
      const parts = text.split('```');
      if (parts.length >= 2) {
        text = parts[1]!.replace(/^json/i, '').trim();
      }
    }
    return text;
  }
}
