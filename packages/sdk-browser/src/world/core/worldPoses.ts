import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import type { Batch, Seat } from './worldBatches.ts';
import { copyElements } from '../../math/matrixElements.ts';
import { writeModelNode } from './modelNodes.ts';

/** A loaded model, drawn whole through a host node posed by its world matrix alone
 *  (`worldMirror.ts`). */
export type PosedTwin = {
  matrixAutoUpdate: boolean;
  visible: boolean;
  matrix: { elements: { [index: number]: number } };
};

/** A sprite's row, rewritten at every write (`spriteRow`). */
const spriteScratch = new Float64Array(16);

/**
 * The row of a sprite: where it stands and its scale on `x` and `y`, all the rasters read of it
 * (`spriteAt`), never its turn — the reference draws a sprite by its position and its axes'
 * lengths alone. Its third axis, which no raster reads, is `(m − x, m − y, m)`, `m` the larger
 * scale: the cube of its pages (`runtimePrimitive.ts`), of half-width `r`, then spans `r·m` on
 * every axis of the world — the farthest a corner lies from the origin once scaled, whichever way
 * the camera or the material's rotation turns it, a long side laid along any world axis included.
 */
function spriteRow(world: ArrayLike<number>) {
  const x = Math.hypot(world[0], world[1], world[2]),
    y = Math.hypot(world[4], world[5], world[6]),
    m = Math.max(x, y);
  spriteScratch.fill(0);
  spriteScratch[0] = x;
  spriteScratch[5] = y;
  spriteScratch[8] = m - x;
  spriteScratch[9] = m - y;
  spriteScratch[10] = m;
  for (let i = 12; i < 15; i++) spriteScratch[i] = world[i];
  spriteScratch[15] = 1;
  return spriteScratch;
}

/** True when `node` is rooted under `scene` — and, when `visibleOnly`, it and every ancestor up
 *  to the scene visible. */
export function rootedUnder(node: Object3D, scene: Object3D, visibleOnly = false) {
  for (let walk: Object3D | null = node; walk; walk = walk.parent) {
    if (visibleOnly && !walk.visible) return false;
    if (walk === scene) return true;
  }
  return false;
}

/** True when `node` is drawn: rooted under `scene`, and it and every ancestor visible. */
export const shownUnder = (node: Object3D, scene: Object3D) => rootedUnder(node, scene, true);

/**
 * The per-frame change list of a world: the nodes whose pose or visibility moved since the last
 * frame, and the rows those writes touched. `apply` runs once before a frame: each moved node's
 * world matrices are brought up to date in the scene's transform tree — its chain and its
 * subtree, nothing else —, every row and twin under it is written, and the touched range of each
 * instance buffer is handed to the session in one call. A frame with nothing moved does nothing.
 */
export function createWorldPoses() {
  const moved = new Set<Object3D>();
  const ranges = new Map<Batch, { rows: PlacementRows; from: number; to: number }>();
  /** Rows `from`..`to` of a batch were written: the range sent before the next frame grows. */
  const touchRange = (batch: Batch, from: number, to: number) => {
    if (!batch.rows) return;
    const range = ranges.get(batch);
    if (range && range.rows === batch.rows) {
      range.from = Math.min(range.from, from);
      range.to = Math.max(range.to, to);
    } else ranges.set(batch, { rows: batch.rows, from, to });
  };
  const touch = (batch: Batch, row: number) => touchRange(batch, row, row);
  /** Writes one seated mesh's world matrix — a sprite's row (`spriteRow`) — and flag into its
   *  row. */
  const writeSeat = (mesh: Mesh, seat: Seat, shown: boolean) => {
    const rows = seat.batch.rows;
    if (!rows || seat.row < 0) return;
    const world = mesh.matrixWorld.elements;
    rows.matrices.set(mesh.primitive === 'sprite' ? spriteRow(world) : world, seat.row * 16);
    rows.live[seat.row] = shown ? 1 : 0;
    touch(seat.batch, seat.row);
  };
  const writeTwin = (node: Object3D, twin: PosedTwin, shown: boolean) => {
    copyElements(twin.matrix.elements, node.matrixWorld.elements);
    twin.matrixAutoUpdate = false;
    twin.visible = shown;
  };
  return {
    touch,
    touchRange,
    writeSeat,
    writeTwin,
    /** A node's pose or visibility moved: it and its subtree are written before the next frame. */
    moved(node: Object3D) {
      moved.add(node);
    },
    get pending() {
      return moved.size > 0 || ranges.size > 0;
    },
    /** Writes what moved, then hands every touched range to `send`. */
    apply(
      scene: Object3D,
      seats: ReadonlyMap<Mesh, Seat>,
      twins: ReadonlyMap<Object3D, PosedTwin>,
      send: (rows: PlacementRows, from: number, to: number) => void,
    ) {
      if (moved.size) {
        for (const node of moved) {
          // Its chain, then its subtree: the tree recomputes only what a write left dirty. A leaf
          // has no subtree to walk, and the walk scans the whole update order (O(n) per node).
          node.updateWorldMatrix(true, node.children.length > 0);
          const visit = (child: Object3D, shown: boolean) => {
            const drawn = shown && child.visible;
            const seat = seats.get(child as Mesh);
            if (seat) writeSeat(child as Mesh, seat, drawn);
            const twin = twins.get(child);
            if (twin) writeTwin(child, twin, drawn);
            for (const grandchild of child.children) visit(grandchild, drawn);
          };
          // A node of a loaded model is drawn from its graph node, which holds its local pose:
          // the moved node alone is written, its subtree follows in the graph.
          writeModelNode(node);
          visit(node, node === scene || (!!node.parent && shownUnder(node.parent, scene)));
        }
        moved.clear();
      }
      for (const [batch, range] of ranges)
        if (batch.rows === range.rows) send(range.rows, range.from, range.to);
      ranges.clear();
    },
    /** A session about to open reads every row as written: no range is left to send it. */
    settle() {
      ranges.clear();
    },
  };
}
