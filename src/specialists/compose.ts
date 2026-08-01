import { randomUUID } from 'node:crypto';

import { BoundingBox, type Entity, type LayoutInfo, type Region, type Table, type CodeInfo } from '../core/types.js';
import type { SpecialistCapability, SpecialistComposition, SpecialistRunResult } from './types.js';

function replace(run: SpecialistRunResult, capability: SpecialistCapability): boolean {
  return run.route.find((route) => route.capability === capability)?.mode === 'replace';
}

function specialistEntities(run: SpecialistRunResult): Entity[] {
  const entities: Entity[] = [];
  for (const capability of ['ocr', 'objects', 'ui'] as const) {
    const output = run.outputs[capability];
    if (!output) continue;
    const provider = run.route.find((route) => route.capability === capability)!.selectedProvider!;
    if (capability === 'ocr') output.text.forEach((item) => entities.push({
      entityId: randomUUID(), label: 'text_block', bbox: BoundingBox.fromList(item.bbox),
      confidence: item.confidence, text: item.text, metadata: { language: item.language ?? null },
      sourcePlugins: [provider],
    }));
    if (capability === 'objects') output.objects.forEach((item) => entities.push({
      entityId: randomUUID(), label: item.label, bbox: BoundingBox.fromList(item.bbox),
      confidence: item.confidence, metadata: {}, sourcePlugins: [provider],
    }));
    if (capability === 'ui') output.ui.forEach((item) => entities.push({
      entityId: randomUUID(), label: item.label, bbox: BoundingBox.fromList(item.bbox),
      confidence: item.confidence, text: item.text ?? null, elementType: item.elementType ?? null,
      clickable: item.clickable ?? null, metadata: {}, sourcePlugins: [provider],
    }));
  }
  return entities;
}

export function composeSpecialists(
  base: { entities: Entity[]; tables: Table[]; regions: Region[]; layout: LayoutInfo | null; code: CodeInfo | null },
  run: SpecialistRunResult,
): SpecialistComposition {
  const specialist = specialistEntities(run);
  const replacedEntityKinds = new Set<string>();
  if (replace(run, 'ocr')) replacedEntityKinds.add('text_block');
  if (replace(run, 'objects')) replacedEntityKinds.add('object');
  if (replace(run, 'ui')) replacedEntityKinds.add('ui');
  const retained = base.entities.filter((entity) => {
    if (replacedEntityKinds.has('text_block') && entity.label === 'text_block') return false;
    if (replacedEntityKinds.has('ui') && (entity.label.startsWith('ui.') || entity.elementType)) return false;
    if (replacedEntityKinds.has('object') && entity.label !== 'text_block' && !entity.label.startsWith('ui.') && !entity.elementType) return false;
    return true;
  });
  const field = <T>(capability: SpecialistCapability, baseValue: T, specialistValue: T): T =>
    replace(run, capability) ? specialistValue : specialistValue instanceof Array
      ? ([...(baseValue as T[]), ...specialistValue] as T) : specialistValue ?? baseValue;
  const convertRegions = (regions: NonNullable<SpecialistRunResult['outputs']['regions']>['regions']): Region[] =>
    regions.map((region) => ({ ...region,
      bbox: region.bbox ? BoundingBox.fromList(region.bbox) : undefined,
      children: region.children ? convertRegions(region.children) : undefined,
    }));
  const specialistTables = (run.outputs.tables?.tables ?? []).map((table) => ({
    ...table, bbox: table.bbox ? BoundingBox.fromList(table.bbox) : undefined,
  }));
  const specialistRegions = convertRegions(run.outputs.regions?.regions ?? []);
  return {
    entities: [...retained, ...specialist],
    tables: field('tables', base.tables, specialistTables),
    regions: field('regions', base.regions, specialistRegions),
    layout: run.outputs.layout ? field('layout', base.layout, run.outputs.layout.layout) : base.layout,
    code: run.outputs.code ? field('code', base.code, run.outputs.code.code) : base.code,
  };
}
