/**
 * Normalization layer.
 *
 * Converts raw plugin outputs into unified Entity objects: parses bboxes,
 * normalizes labels, assigns IDs, and merges duplicates by label + IoU.
 */

import { BoundingBox, type Entity, type PluginResult } from '../core/types.js';

// Canonical label mapping (subset; extend as providers are added)
const LABEL_MAP: Record<string, string> = {
  person: 'person',
  human: 'person',
  people: 'person',
  pedestrian: 'person',
  car: 'vehicle.car',
  automobile: 'vehicle.car',
  truck: 'vehicle.truck',
  bus: 'vehicle.bus',
  bicycle: 'vehicle.bicycle',
  bike: 'vehicle.bicycle',
  motorcycle: 'vehicle.motorcycle',
  dog: 'animal.dog',
  cat: 'animal.cat',
  bird: 'animal.bird',
  phone: 'device.phone',
  'mobile phone': 'device.phone',
  cellphone: 'device.phone',
  smartphone: 'device.phone',
  laptop: 'device.laptop',
  computer: 'device.computer',
  keyboard: 'device.keyboard',
  mouse: 'device.mouse',
  monitor: 'device.monitor',
  screen: 'device.monitor',
  chair: 'furniture.chair',
  table: 'furniture.table',
  desk: 'furniture.desk',
  button: 'ui.button',
  'push button': 'ui.button',
  textbox: 'ui.input_field',
  'text field': 'ui.input_field',
  input: 'ui.input_field',
  input_field: 'ui.input_field',
  checkbox: 'ui.checkbox',
  'check box': 'ui.checkbox',
  menu: 'ui.menu',
  dropdown: 'ui.dropdown',
  tab: 'ui.tab',
  dialog: 'ui.dialog',
  popup: 'ui.dialog',
  toolbar: 'ui.toolbar',
  sidebar: 'ui.sidebar',
  scrollbar: 'ui.scrollbar',
  container: 'ui.container',
  ui_region: 'ui.region',
};

export class Normalizer {
  private idCounter = 0;

  constructor(private labelMap: Record<string, string> = LABEL_MAP) {}

  normalize(results: PluginResult[]): Entity[] {
    this.idCounter = 0;
    const entities: Entity[] = [];

    for (const result of results) {
      if (result.errors.length > 0) continue;
      entities.push(...this.normalizeOne(result));
    }

    return this.mergeDuplicates(entities);
  }

  private normalizeOne(result: PluginResult): Entity[] {
    const data = result.data;
    const entities: Entity[] = [];

    const textBlocks = data.text_blocks as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(textBlocks)) {
      for (const block of textBlocks) {
        entities.push(this.fromOcr(block, result.plugin));
      }
    }

    const objects = data.objects as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(objects)) {
      for (const obj of objects) {
        entities.push(this.fromDetection(obj, result.plugin));
      }
    }

    const uiElements = data.ui_elements as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(uiElements)) {
      for (const el of uiElements) {
        entities.push(this.fromUi(el, result.plugin));
      }
    }

    const regions = data.regions as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(regions)) {
      for (const region of regions) {
        entities.push(this.fromLayout(region, result.plugin));
      }
    }

    return entities;
  }

  private fromOcr(block: Record<string, unknown>, source: string): Entity {
    return {
      entityId: this.nextId(),
      label: 'text_block',
      bbox: this.parseBbox(block.bbox as number[]),
      confidence: Number(block.confidence ?? 0),
      text: (block.text as string) ?? null,
      // Tier 4: carry rich text attributes (color/emphasis) when present.
      metadata: {
        language: block.language ?? null,
        ...(block.color ? { color: block.color } : {}),
        ...(block.emphasis ? { emphasis: block.emphasis } : {}),
      },
      sourcePlugins: [source],
    };
  }

  private fromDetection(obj: Record<string, unknown>, source: string): Entity {
    return {
      entityId: this.nextId(),
      label: this.normLabel((obj.label as string) ?? 'object'),
      bbox: this.parseBbox(obj.bbox as number[]),
      confidence: Number(obj.confidence ?? 0),
      metadata: {},
      sourcePlugins: [source],
    };
  }

  private fromUi(el: Record<string, unknown>, source: string): Entity {
    return {
      entityId: this.nextId(),
      label: this.normLabel((el.label as string) ?? 'ui_element'),
      bbox: this.parseBbox(el.bbox as number[]),
      confidence: Number(el.confidence ?? 0),
      text: (el.text as string) ?? null,
      elementType: (el.element_type as string) ?? null,
      clickable: (el.clickable as boolean) ?? null,
      enabled: (el.enabled as boolean) ?? null,
      focused: (el.focused as boolean) ?? null,
      metadata: {},
      sourcePlugins: [source],
    };
  }

  private fromLayout(region: Record<string, unknown>, source: string): Entity {
    return {
      entityId: this.nextId(),
      label: 'layout_region',
      bbox: this.parseBbox(region.bbox as number[]),
      confidence: Number(region.confidence ?? 1),
      elementType: (region.type as string) ?? null,
      metadata: {},
      sourcePlugins: [source],
    };
  }

  private parseBbox(coords: number[] | undefined): BoundingBox {
    if (!Array.isArray(coords) || coords.length !== 4) {
      return new BoundingBox(0, 0, 0, 0);
    }
    return BoundingBox.fromList(coords.map(Number));
  }

  private normLabel(label: string): string {
    const key = label.trim().toLowerCase();
    return this.labelMap[key] ?? key;
  }

  private nextId(): string {
    this.idCounter += 1;
    return `e${this.idCounter}`;
  }

  private mergeDuplicates(entities: Entity[], iouThreshold = 0.5): Entity[] {
    if (entities.length < 2) return entities;

    const merged: Entity[] = [];
    const used = new Array(entities.length).fill(false);

    for (let i = 0; i < entities.length; i++) {
      if (used[i]) continue;
      const group = [entities[i]!];
      for (let j = i + 1; j < entities.length; j++) {
        if (used[j]) continue;
        const a = entities[i]!;
        const b = entities[j]!;
        if (a.label === b.label && a.bbox.iou(b.bbox) > iouThreshold) {
          group.push(b);
          used[j] = true;
        }
      }
      used[i] = true;
      merged.push(this.mergeGroup(group));
    }
    return merged;
  }

  private mergeGroup(group: Entity[]): Entity {
    if (group.length === 1) return group[0]!;
    const base = group.reduce((best, e) => (e.confidence > best.confidence ? e : best));
    const sources = new Set<string>();
    for (const e of group) e.sourcePlugins.forEach((s) => sources.add(s));
    base.sourcePlugins = [...sources];
    return base;
  }
}
