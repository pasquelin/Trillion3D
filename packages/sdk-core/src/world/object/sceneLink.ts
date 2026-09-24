import type { Object3D } from './object3d.ts';

/**
 * A mesh's row in the instance buffer its world draws it from: sixteen column-major floats at
 * `row * 16` of `batch.rows.matrices`, which the renderer reads in place (`placement/rows.ts`).
 */
export interface PlacedRow {
  readonly batch: { readonly rows: { readonly matrices: Float64Array } | null };
  readonly row: number;
}

/** What a node reports to the world it hangs in: a pose moved, the tree changed, a content changed. */
export interface SceneLink {
  /** A node moved. */ pose(node: Object3D): void;
  /** Many nodes moved at once, written straight into their tree (the physics' bodies): told once. */
  posed(nodes: readonly Object3D[]): void;
  /** A node gained or lost children. */ structure(node: Object3D): void;
  /** A node's shape or material changed. */ content(node: Object3D): void;
  /**
   * The row `node` is drawn from, or `null` when it holds none: an owner placing nodes by the
   * thousand (the physics) writes their world matrices there itself, valid while `seatEpoch`
   * stands, and names the rows it wrote through `placed`.
   */
  seat?(node: Object3D): PlacedRow | null;
  /** Moves whenever a row is taken, freed or reallocated: every `seat` answer before it is stale. */
  seatEpoch?(): number;
  /** Rows `from` to `to` of `batch` were written through `seat`: drawn at the next frame. */
  placed?(batch: PlacedRow['batch'], from: number, to: number): void;
}
