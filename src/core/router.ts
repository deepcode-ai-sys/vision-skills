/**
 * Mode Router.
 *
 * Decides which processing mode to run based on: explicit request,
 * classifier result, and remaining budget. Fail-safe to Standard when
 * uncertain.
 */

import type {
  ClassificationResult,
  ModeSelection,
  ModePolicy,
  PluginType,
  ProcessingMode,
  RequestedMode,
} from './types.js';

const MODE_POLICIES: Record<ProcessingMode, ModePolicy> = {
  basic: {
    pluginTypes: ['ocr'],
    combinedStructuredFields: false,
    semantic: false,
    reasoner: false,
  },
  standard: {
    pluginTypes: ['ocr', 'detection', 'ui'],
    combinedStructuredFields: true,
    semantic: false,
    reasoner: false,
  },
  advanced: {
    pluginTypes: ['ocr', 'detection', 'ui'],
    combinedStructuredFields: true,
    semantic: true,
    reasoner: false,
  },
  full: {
    pluginTypes: ['ocr', 'detection', 'ui'],
    combinedStructuredFields: true,
    semantic: true,
    reasoner: true,
  },
};

const MODE_COST_RANGE: Record<ProcessingMode, string> = {
  basic: '0.002-0.005',
  standard: '0.005-0.015',
  advanced: '0.015-0.030',
  full: '0.030-0.100',
};

export class ModeRouter {
  constructor(private finalThreshold = 0.6) {}

  select(
    classification: ClassificationResult,
    requestedMode: RequestedMode = 'auto',
    budgetRemaining?: number,
  ): ModeSelection {
    let mode: ProcessingMode;
    let reason: string;

    if (requestedMode !== 'auto') {
      mode = requestedMode;
      reason = 'client_explicit_request';
    } else {
      [mode, reason] = this.autoSelect(classification);
    }

    if (budgetRemaining !== undefined) {
      [mode, reason] = this.applyBudgetGuard(mode, reason, budgetRemaining);
    }

    return {
      modeSelected: mode,
      reason,
      estimatedCostRange: MODE_COST_RANGE[mode],
    };
  }

  private autoSelect(c: ClassificationResult): [ProcessingMode, string] {
    if (c.type === 'mixed' || c.confidence < this.finalThreshold) {
      return ['standard', 'classifier_confidence_below_threshold'];
    }
    if (c.type === 'document') {
      return c.characteristics.hasUiElements
        ? ['standard', 'complex_document_layout']
        : ['basic', 'simple_document_text_extraction'];
    }
    if (c.type === 'screen_ui') {
      return ['standard', 'screen_ui_needs_layout_detection'];
    }
    if (c.type === 'real_world') {
      return ['standard', 'real_world_default'];
    }
    return ['standard', 'default_fallback'];
  }

  private applyBudgetGuard(
    mode: ProcessingMode,
    reason: string,
    budgetRemaining: number,
  ): [ProcessingMode, string] {
    if (budgetRemaining <= 0) {
      return ['basic', 'budget_exhausted_forced_basic'];
    }
    if (budgetRemaining < 1.0 && (mode === 'advanced' || mode === 'full')) {
      return ['standard', 'budget_low_downgraded'];
    }
    return [mode, reason];
  }

  static pluginTypesFor(mode: ProcessingMode): PluginType[] {
    return [...MODE_POLICIES[mode].pluginTypes];
  }

  static policyFor(mode: ProcessingMode): ModePolicy {
    const policy = MODE_POLICIES[mode];
    return { ...policy, pluginTypes: [...policy.pluginTypes] };
  }
}
