import { describe, it, expect } from 'vitest';

import { SpatialGraphBuilder } from '../src/scene-graph/spatial.js';
import { BoundingBox, type Entity } from '../src/core/types.js';

function entity(id: string, box: number[]): Entity {
  return {
    entityId: id,
    label: 'x',
    bbox: BoundingBox.fromList(box),
    confidence: 1,
    metadata: {},
    sourcePlugins: [],
  };
}

describe('SpatialGraphBuilder.assignHierarchy', () => {
  it('assigns the tightest containing parent', () => {
    const outer = entity('e1', [0, 0, 1000, 1000]); // whole screen
    const panel = entity('e2', [100, 100, 500, 500]); // panel inside screen
    const button = entity('e3', [150, 150, 250, 200]); // button inside panel

    SpatialGraphBuilder.assignHierarchy([outer, panel, button]);

    expect(outer.parentId).toBeNull();
    expect(panel.parentId).toBe('e1'); // parent is the screen
    expect(button.parentId).toBe('e2'); // parent is the panel (tightest), not screen
  });

  it('leaves standalone entities without a parent', () => {
    const a = entity('e1', [0, 0, 100, 100]);
    const b = entity('e2', [500, 500, 600, 600]);
    SpatialGraphBuilder.assignHierarchy([a, b]);
    expect(a.parentId).toBeNull();
    expect(b.parentId).toBeNull();
  });

  it('does not make identical boxes parents of each other', () => {
    const a = entity('e1', [0, 0, 100, 100]);
    const b = entity('e2', [0, 0, 100, 100]);
    SpatialGraphBuilder.assignHierarchy([a, b]);
    expect(a.parentId).toBeNull();
    expect(b.parentId).toBeNull();
  });
});
