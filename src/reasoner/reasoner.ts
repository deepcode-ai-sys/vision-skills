/**
 * Reasoner module (VLM-backed, Advanced/Full only).
 *
 * Runs AFTER the scene graph is complete. Interprets UI state, generates
 * action hints, detects anomalies, and produces a semantic summary.
 */

import type {
  ActionHint,
  Entity,
  ImageType,
  ReasonerOutput,
  SceneGraph,
} from '../core/types.js';
import type { VLMClient } from '../scene-graph/semantic.js';

export class Reasoner {
  constructor(private vlm: VLMClient | null) {}

  async reason(
    image: Buffer,
    entities: Entity[],
    sceneGraph: SceneGraph,
    imageType: ImageType,
  ): Promise<ReasonerOutput | null> {
    if (!this.vlm) return null;

    const prompt = this.buildPrompt(entities, sceneGraph, imageType);
    let raw: string;
    try {
      raw = await this.vlm.askJson(image, prompt, 1024);
    } catch {
      return null;
    }
    return this.parse(raw);
  }

  private buildPrompt(
    entities: Entity[],
    sceneGraph: SceneGraph,
    imageType: ImageType,
  ): string {
    const entitySummary = entities
      .slice(0, 50)
      .map((e) => {
        let line = `  - ${e.entityId}: ${e.label}`;
        if (e.text) line += ` text="${e.text}"`;
        if (e.elementType) line += ` type=${e.elementType}`;
        return line;
      })
      .join('\n');

    const spatialSummary = sceneGraph.spatial
      .slice(0, 40)
      .map((edge) => `  - ${edge.subjectId} ${edge.relation} ${edge.objectId}`)
      .join('\n');

    let contextHint = '';
    if (imageType === 'screen_ui') {
      contextHint =
        'This is a UI screenshot. Focus on: what screen/app this is, what ' +
        'state the UI is in, and what actions a user could take.';
    } else if (imageType === 'real_world') {
      contextHint =
        'This is a real-world photo. Focus on: the main subject, the ' +
        'activity happening, and the overall context.';
    } else if (imageType === 'document') {
      contextHint =
        'This is a document. Focus on: document type, key content, and structure.';
    }

    return (
      `You are analyzing an image. ${contextHint}\n\n` +
      'Detected entities:\n' +
      `${entitySummary || '  (none)'}\n\n` +
      'Spatial relationships:\n' +
      `${spatialSummary || '  (none)'}\n\n` +
      'Provide reasoning as ONLY a JSON object (no markdown) with this exact shape:\n' +
      '{\n' +
      '  "summary": "one or two sentence semantic summary",\n' +
      '  "ui_state_interpretation": "state description or null",\n' +
      '  "action_hints": [{"action": "click", "target": "entity_id or description", "reason": "why"}],\n' +
      '  "anomalies": ["any unusual or broken things you notice"],\n' +
      '  "reasoning_confidence": 0.85\n' +
      '}'
    );
  }

  private parse(raw: string): ReasonerOutput | null {
    let text = raw.trim();
    if (text.startsWith('```')) {
      const parts = text.split('```');
      if (parts.length >= 2) {
        text = parts[1]!.replace(/^json/i, '').trim();
      }
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      // Fallback: use raw text as summary
      return {
        summary: raw.slice(0, 500).trim() || 'No summary available',
        uiStateInterpretation: null,
        actionHints: [],
        anomalies: [],
        reasoningConfidence: 0.3,
      };
    }

    if (typeof data !== 'object' || data === null) return null;
    const rec = data as Record<string, unknown>;

    return {
      summary: String(rec.summary ?? ''),
      uiStateInterpretation: (rec.ui_state_interpretation as string) ?? null,
      actionHints: (rec.action_hints as ActionHint[]) ?? [],
      anomalies: (rec.anomalies as string[]) ?? [],
      reasoningConfidence: Number(rec.reasoning_confidence ?? 0.5),
    };
  }
}
