/**
 * Reasoner module (VLM-backed) with a Fable-style thinking protocol.
 *
 * Unlike a single-shot "summarize this" call, this runs a structured
 * reasoning loop before concluding:
 *
 *   observe     → state only what is actually SEEN (no interpretation)
 *   ground      → classify each claim: OBSERVED vs ASSUMED
 *   hypothesize → hold ≥2 hypotheses about what the image is
 *   verify      → which observed details discriminate the hypotheses
 *   self_review → what could have been misread? weakest link?
 *   deliver     → calibrated conclusion, confidence, open questions
 *
 * The full trace is returned so a text-only model can see HOW the
 * conclusion was reached, not just the conclusion.
 */

import type {
  ActionHint,
  Entity,
  ImageType,
  ReasonerOutput,
  SceneGraph,
  ThinkingStep,
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
      raw = await this.vlm.askJson(image, prompt, 2048);
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
      .slice(0, 80)
      .map((e) => {
        let line = `  - ${e.entityId}: ${e.label}`;
        if (e.text) line += ` text="${e.text}"`;
        if (e.elementType) line += ` type=${e.elementType}`;
        if (e.metadata?.color) line += ` color=${e.metadata.color}`;
        if (e.metadata?.emphasis) line += ` emphasis=${e.metadata.emphasis}`;
        return line;
      })
      .join('\n');

    const spatialSummary = sceneGraph.spatial
      .slice(0, 60)
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
      `You are analyzing an image using a disciplined reasoning protocol. ${contextHint}\n\n` +
      'Detected entities (from the extraction pass):\n' +
      `${entitySummary || '  (none)'}\n\n` +
      'Spatial relationships:\n' +
      `${spatialSummary || '  (none)'}\n\n` +
      'Reason through the image IN ORDER, then return a JSON object (no markdown) with this exact shape:\n' +
      '{\n' +
      '  "thinking_trace": [\n' +
      '    {"phase": "observe", "content": "Only what is literally visible. No interpretation."},\n' +
      '    {"phase": "ground", "content": "Which observations are certain vs assumed. E.g. text read clearly vs guessed from blur."},\n' +
      '    {"phase": "hypothesize", "content": "At least TWO hypotheses about what this image/screen is. Write both down."},\n' +
      '    {"phase": "verify", "content": "Which observed detail(s) discriminate between the hypotheses. Which hypothesis wins and why."},\n' +
      '    {"phase": "self_review", "content": "What could I have misread? Text that might be wrong? Icons guessed? What is the weakest link?"},\n' +
      '    {"phase": "deliver", "content": "The conclusion with calibrated confidence."}\n' +
      '  ],\n' +
      '  "summary": "one or two sentence semantic summary",\n' +
      '  "ui_state_interpretation": "state description or null",\n' +
      '  "action_hints": [{"action": "click", "target": "entity_id or description", "reason": "why"}],\n' +
      '  "anomalies": ["any unusual or broken things you notice"],\n' +
      '  "open_questions": ["anything you could not fully verify"],\n' +
      '  "reasoning_confidence": 0.85\n' +
      '}\n\n' +
      'Discipline rules:\n' +
      '- OBSERVE phase must not interpret: state pixels/text/objects, not meaning.\n' +
      '- GROUND phase: label each load-bearing observation OBSERVED or ASSUMED.\n' +
      '- HYPOTHESIZE phase: two hypotheses minimum. One hypothesis is pattern-matching.\n' +
      '- SELF_REVIEW phase: be adversarial toward your own reading. What would prove you wrong?\n' +
      '- DELIVER phase: confidence must match evidence. Blurry text = lower confidence.'
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

    // Parse thinking trace (defensive: keep only valid phases)
    const thinkingTrace: ThinkingStep[] = [];
    const validPhases = new Set([
      'observe',
      'ground',
      'hypothesize',
      'verify',
      'self_review',
      'deliver',
    ]);
    const rawTrace = Array.isArray(rec.thinking_trace) ? rec.thinking_trace : [];
    for (const step of rawTrace) {
      if (typeof step !== 'object' || step === null) continue;
      const s = step as Record<string, unknown>;
      const phase = s.phase as string;
      const content = String(s.content ?? '');
      if (validPhases.has(phase) && content) {
        thinkingTrace.push({ phase: phase as ThinkingStep['phase'], content });
      }
    }

    const openQuestions = Array.isArray(rec.open_questions)
      ? rec.open_questions.map((q) => String(q)).filter(Boolean)
      : [];

    return {
      summary: String(rec.summary ?? ''),
      uiStateInterpretation: (rec.ui_state_interpretation as string) ?? null,
      actionHints: (rec.action_hints as ActionHint[]) ?? [],
      anomalies: (rec.anomalies as string[]) ?? [],
      reasoningConfidence: Number(rec.reasoning_confidence ?? 0.5),
      thinkingTrace: thinkingTrace.length > 0 ? thinkingTrace : undefined,
      openQuestions: openQuestions.length > 0 ? openQuestions : undefined,
    };
  }
}
