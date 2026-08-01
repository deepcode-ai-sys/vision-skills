/**
 * Spatial relationship builder.
 *
 * Computes geometric relations (left_of, above, near, contains...) purely
 * from bounding boxes. No VLM required — runs in all modes.
 *
 * Uses spatial grid indexing to optimize O(n²) to O(n*k) for dense images.
 */

import {
  BoundingBox,
  type Entity,
  type SpatialRelation,
  type SpatialRelationEdge,
} from '../core/types.js';

/**
 * Simple spatial grid for accelerating neighbor queries.
 * Divides image into cells and assigns entities to cells based on bbox.
 */
class SpatialGrid {
  private cells: Map<string, Entity[]> = new Map();
  private cellSize: number;

  constructor(imageWidth: number, imageHeight: number, gridDivisions = 10) {
    // Adaptive cell size based on image dimensions
    this.cellSize = Math.max(imageWidth, imageHeight) / gridDivisions;
  }

  add(entity: Entity): void {
    // Add entity to all cells it overlaps
    const { x1, y1, x2, y2 } = entity.bbox;
    const minCellX = Math.floor(x1 / this.cellSize);
    const maxCellX = Math.floor(x2 / this.cellSize);
    const minCellY = Math.floor(y1 / this.cellSize);
    const maxCellY = Math.floor(y2 / this.cellSize);

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const key = `${cx},${cy}`;
        if (!this.cells.has(key)) {
          this.cells.set(key, []);
        }
        this.cells.get(key)!.push(entity);
      }
    }
  }

  /** Get entities near a given entity (only checks nearby cells). */
  getNearby(entity: Entity): Entity[] {
    const nearby = new Set<Entity>();
    const { x1, y1, x2, y2 } = entity.bbox;

    // Check cells that bbox touches + 1 cell margin
    const minCellX = Math.floor(x1 / this.cellSize) - 1;
    const maxCellX = Math.floor(x2 / this.cellSize) + 1;
    const minCellY = Math.floor(y1 / this.cellSize) - 1;
    const maxCellY = Math.floor(y2 / this.cellSize) + 1;

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const key = `${cx},${cy}`;
        const cell = this.cells.get(key);
        if (cell) {
          cell.forEach(e => nearby.add(e));
        }
      }
    }

    // Remove self
    nearby.delete(entity);
    return Array.from(nearby);
  }
}

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

    // Build adaptive spatial grid. Cell size scales with image so far-apart
    // entities still share cells. For 1920x1080, cellSize ~= 192px.
    const imageW = Math.max(...entities.map(e => e.bbox.x2)) || 1920;
    const imageH = Math.max(...entities.map(e => e.bbox.y2)) || 1080;
    const gridDivisions = Math.max(6, Math.ceil(Math.sqrt(n) / 3)); // Scale with entity count
    const grid = new SpatialGrid(imageW, imageH, gridDivisions);
    for (const e of entities) {
      grid.add(e);
    }

    for (let i = 0; i < n; i++) {
      const a = entities[i]!;

      // 1. Containment + overlap: use spatial grid to avoid O(n²) for ALL pairs
      const nearby = grid.getNearby(a);
      const seenIds = new Set<string>();
      for (const b of nearby) {
        if (a.entityId === b.entityId) continue;
        seenIds.add(b.entityId);

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

      // 2. Directional + near: K-nearest from ALL entities (already bounded, cheap per pair)
      const allCandidates = entities.filter(e => e.entityId !== a.entityId);
      const neighbors = this.nearestNeighbors(a, allCandidates);
      for (const b of neighbors) {
        edges.push(...this.directional(a, b));
      }
    }

    // Deduplicate: keep highest confidence for each (subject, relation, object) triple
    return this.deduplicateRelations(edges);
  }

  /** Remove duplicate relations, keeping the one with highest confidence. */
  private deduplicateRelations(edges: SpatialRelationEdge[]): SpatialRelationEdge[] {
    const map = new Map<string, SpatialRelationEdge>();
    for (const edge of edges) {
      const key = `${edge.subjectId}:${edge.relation}:${edge.objectId}`;
      const existing = map.get(key);
      if (!existing || edge.confidence > existing.confidence) {
        map.set(key, edge);
      }
    }
    return Array.from(map.values());
  }

  /** Return the K nearest entities to `a` by center distance from candidates. */
  private nearestNeighbors(a: Entity, candidates: Entity[]): Entity[] {
    const scored: Array<{ entity: Entity; dist: number }> = [];
    for (const b of candidates) {
      if (b.entityId === a.entityId) continue; // Skip self
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
