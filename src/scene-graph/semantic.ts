/**
 * Semantic relationship builder (VLM-backed).
 *
 * Uses a VLM to infer semantic relations between already-detected entities.
 * Runs only in Advanced/Full modes. The VLM may only reference existing
 * entity IDs and use the fixed relation taxonomy.
 */

import {
  ALLOWED_SEMANTIC_RELATIONS,
  type Entity,
  type SemanticRelationEdge,
} from '../core/types.js';

/** A VLM client that can answer a prompt about an image, returning text. */
export interface VLMClient {
  askJson(image: Buffer, prompt: string, maxTokens?: number): Promise<string>;
}

export class SemanticGraphBuilder {
  constructor(private vlm: VLMClient | null) {}

  async build(image: Buffer, entities: Entity[]): Promise<SemanticRelationEdge[]> {
    if (!this.vlm || entities.length < 2) return [];

    const prompt = this.buildPrompt(entities);
    let raw: string;
    try {
      raw = await this.vlm.askJson(image, prompt);
    } catch {
      return [];
    }
    return this.parseEdges(raw, entities);
  }

  private buildPrompt(entities: Entity[]): string {
    const lines = entities
      .map(
        (e) =>
          `  - id="${e.entityId}", label="${e.label}", bbox=[${e.bbox
            .toList()
            .join(',')}]`,
      )
      .join('\n');
    const relations = [...ALLOWED_SEMANTIC_RELATIONS].sort().join(', ');
    return (
      'You are analyzing an image. Below is a list of entities already ' +
      'detected, each with an ID, label, and bounding box [x1,y1,x2,y2]:\n\n' +
      `${lines}\n\n` +
      'Identify SEMANTIC relationships between these entities based on what ' +
      'you see in the image. ' +
      `You may ONLY use these relation types: ${relations}.\n` +
      'You may ONLY reference the entity IDs listed above - do not invent ' +
      'new objects.\n\n' +
      'Respond with ONLY a JSON array (no markdown, no explanation) of ' +
      'objects with this exact shape:\n' +
      '[{"subject_id": "e1", "relation": "holding", "object_id": "e3", ' +
      '"confidence": 0.9}]\n' +
      'If there are no clear semantic relationships, respond with [].'
    );
  }

  private parseEdges(raw: string, entities: Entity[]): SemanticRelationEdge[] {
    const validIds = new Set(entities.map((e) => e.entityId));
    const text = this.stripFences(raw);

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return [];
    }
    if (!Array.isArray(data)) return [];

    const edges: SemanticRelationEdge[] = [];
    for (const item of data) {
      if (typeof item !== 'object' || item === null) continue;
      const rec = item as Record<string, unknown>;
      const subjectId = rec.subject_id as string;
      const relation = rec.relation as string;
      const objectId = rec.object_id as string;

      if (!validIds.has(subjectId) || !validIds.has(objectId)) continue;
      if (!ALLOWED_SEMANTIC_RELATIONS.has(relation)) continue;
      if (subjectId === objectId) continue;

      edges.push({
        subjectId,
        relation,
        objectId,
        confidence: Number(rec.confidence ?? 0.7),
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
