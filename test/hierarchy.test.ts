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

describe('SpatialGraphBuilder edge explosion control', () => {
  const thresholds = {
    thresholdX: 0.05,
    thresholdY: 0.05,
    nearThreshold: 0.15,
    overlapIouThreshold: 0.1,
    maxNeighbors: 3,
  };

  function grid(n: number): Entity[] {
    // n small non-overlapping boxes spread across a 1000x1000 image
    const cols = Math.ceil(Math.sqrt(n));
    const out: Entity[] = [];
    for (let i = 0; i < n; i++) {
      const cx = (i % cols) * 90 + 10;
      const cy = Math.floor(i / cols) * 90 + 10;
      out.push(entity(`e${i}`, [cx, cy, cx + 20, cy + 20]));
    }
    return out;
  }

  it('does not explode to O(n^2) directional edges on dense images', () => {
    const entities = grid(50); // 50 entities
    const builder = new SpatialGraphBuilder(1000, 1000, thresholds);
    const edges = builder.build(entities);

    // Naive O(n^2) would be ~50*49 = 2450+ directional edges alone.
    // With maxNeighbors=3, directional edges are bounded to ~n * 3 * (a few
    // relations each). Assert the total stays an order of magnitude smaller.
    expect(edges.length).toBeLessThan(50 * 3 * 4 + 100);
  });

  it('still produces directional relations for close neighbors', () => {
    const a = entity('e1', [10, 100, 30, 120]);
    const b = entity('e2', [500, 100, 520, 120]); // to the right
    const builder = new SpatialGraphBuilder(1000, 1000, thresholds);
    const edges = builder.build([a, b]);
    const rels = new Set(edges.map((e) => `${e.subjectId}:${e.relation}:${e.objectId}`));
    expect(rels.has('e1:left_of:e2')).toBe(true);
  });
});
