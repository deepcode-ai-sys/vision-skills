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
}

export class SpatialGraphBuilder {
  private tx: number;
  private ty: number;
  private nearDist: number;
  private iouThreshold: number;

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
  }

  build(entities: Entity[]): SpatialRelationEdge[] {
    const edges: SpatialRelationEdge[] = [];
    const n = entities.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        edges.push(...this.relate(entities[i]!, entities[j]!));
      }
    }
    return edges;
  }

  private relate(a: Entity, b: Entity): SpatialRelationEdge[] {
    const edges: SpatialRelationEdge[] = [];
    const boxA = a.bbox;
    const boxB = b.bbox;

    if (this.contains(boxA, boxB)) {
      edges.push(this.edge(a.entityId, 'contains', b.entityId));
      return edges;
    }

    const iou = boxA.iou(boxB);
    if (iou > this.iouThreshold) {
      edges.push({
        subjectId: a.entityId,
        relation: 'overlapping',
        objectId: b.entityId,
        confidence: Math.round(Math.min(1, iou * 2) * 1000) / 1000,
      });
    }

    const dx = boxB.centerX - boxA.centerX;
    const dy = boxB.centerY - boxA.centerY;

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
}
