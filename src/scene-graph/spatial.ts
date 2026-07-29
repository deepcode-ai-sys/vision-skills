/**
 * Spatial relationship builder.
 *
 * Computes geometric relations (left_of, above, near, contains...) purely
 * from bounding boxes. No VLM required — runs in all modes.
 */

import {
  BoundingBox,
  type Entity,
  type SpatialRelation,
  type SpatialRelationEdge,
} from '../core/types.js';

export interface SpatialThresholds {
  thresholdX: number; // fraction of image width
  thresholdY: number; // fraction of image height
  nearThreshold: number; // fraction of image diagonal
  overlapIouThreshold: number;
  /**
   * Max directional/near neighbors kept per entity. Prevents O(n^2) edge
   * explosion on dense images (e.g. a dashboard with 100+ text blocks).
   * `contains` and `overlapping` relations are always kept regardless.
   * Default 6.
   */
  maxNeighbors?: number;
}

export class SpatialGraphBuilder {
  private tx: number;
  private ty: number;
  private nearDist: number;
  private iouThreshold: number;
  private maxNeighbors: number;

  constructor(
    imageWidth: number,
    imageHeight: number,
    thresholds: SpatialThresholds,
  ) {
    this.tx = thresholds.thresholdX * imageWidth;
    this.ty = thresholds.thresholdY * imageHeight;
    const diagonal = Math.hypot(imageWidth, imageHeight);
    this.nearDist = thresholds.nearThreshold * diagonal;
    this.iouThreshold = thresholds.overlapIouThreshold;
    this.maxNeighbors = thresholds.maxNeighbors ?? 6;
  }

  build(entities: Entity[]): SpatialRelationEdge[] {
    const edges: SpatialRelationEdge[] = [];
    const n = entities.length;

    for (let i = 0; i < n; i++) {
      const a = entities[i]!;

      // 1. Containment + overlap: keep for ALL pairs (these are meaningful
      //    and relatively rare, so no explosion risk).
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const b = entities[j]!;
        if (this.contains(a.bbox, b.bbox)) {
          edges.push(this.edge(a.entityId, 'contains', b.entityId));
          continue;
        }
        const iou = a.bbox.iou(b.bbox);
        if (iou > this.iouThreshold) {
          edges.push({
            subjectId: a.entityId,
            relation: 'overlapping',
            objectId: b.entityId,
            confidence: Math.round(Math.min(1, iou * 2) * 1000) / 1000,
          });
        }
      }

      // 2. Directional + near: only for the K nearest neighbors of `a`.
      //    This is what keeps the graph small and meaningful on dense images.
      const neighbors = this.nearestNeighbors(a, entities, i);
      for (const b of neighbors) {
        edges.push(...this.directional(a, b));
      }
    }

    return edges;
  }

  /** Return the K nearest entities to `a` by center distance. */
  private nearestNeighbors(a: Entity, entities: Entity[], selfIndex: number): Entity[] {
    const scored: Array<{ entity: Entity; dist: number }> = [];
    for (let j = 0; j < entities.length; j++) {
      if (j === selfIndex) continue;
      const b = entities[j]!;
      const dx = b.bbox.centerX - a.bbox.centerX;
      const dy = b.bbox.centerY - a.bbox.centerY;
      scored.push({ entity: b, dist: Math.hypot(dx, dy) });
    }
    scored.sort((x, y) => x.dist - y.dist);
    return scored.slice(0, this.maxNeighbors).map((s) => s.entity);
  }

  /** Directional (left/right/above/below) + near relations from a to b. */
  private directional(a: Entity, b: Entity): SpatialRelationEdge[] {
    const edges: SpatialRelationEdge[] = [];
    const dx = b.bbox.centerX - a.bbox.centerX;
    const dy = b.bbox.centerY - a.bbox.centerY;

    if (dx > this.tx) edges.push(this.edge(a.entityId, 'left_of', b.entityId));
    else if (dx < -this.tx) edges.push(this.edge(a.entityId, 'right_of', b.entityId));

    if (dy > this.ty) edges.push(this.edge(a.entityId, 'above', b.entityId));
    else if (dy < -this.ty) edges.push(this.edge(a.entityId, 'below', b.entityId));

    if (Math.hypot(dx, dy) < this.nearDist) {
      edges.push(this.edge(a.entityId, 'near', b.entityId));
    }

    return edges;
  }

  private edge(
    subjectId: string,
    relation: SpatialRelation,
    objectId: string,
  ): SpatialRelationEdge {
    return { subjectId, relation, objectId, confidence: 1.0 };
  }

  private contains(outer: BoundingBox, inner: BoundingBox): boolean {
    const inside =
      outer.x1 <= inner.x1 &&
      outer.y1 <= inner.y1 &&
      outer.x2 >= inner.x2 &&
      outer.y2 >= inner.y2;
    return inside && outer.area > 1.5 * inner.area;
  }

  /**
   * Assign UI/layout hierarchy by mutating each entity's `parentId`.
   *
   * Each entity's parent is the SMALLEST other entity that fully contains it
   * (so nesting is tight, not just the outermost container). Runs in-place.
   */
  static assignHierarchy(entities: Entity[]): void {
    for (const child of entities) {
      let bestParent: Entity | null = null;
      for (const candidate of entities) {
        if (candidate.entityId === child.entityId) continue;
        if (!SpatialGraphBuilder.fullyContains(candidate.bbox, child.bbox)) continue;
        // Prefer the smallest containing box (tightest parent).
        if (bestParent === null || candidate.bbox.area < bestParent.bbox.area) {
          bestParent = candidate;
        }
      }
      child.parentId = bestParent ? bestParent.entityId : null;
    }
  }

  private static fullyContains(outer: BoundingBox, inner: BoundingBox): boolean {
    const inside =
      outer.x1 <= inner.x1 &&
      outer.y1 <= inner.y1 &&
      outer.x2 >= inner.x2 &&
      outer.y2 >= inner.y2;
    // Strictly larger so an identical box isn't its own parent.
    return inside && outer.area > inner.area * 1.05;
  }
}
