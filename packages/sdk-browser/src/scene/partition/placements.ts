/**
 * THE ROWS THE PLACED CELLS OF A PARTITION HOLD (#404): each node of a placed cell on a row of its
 * mesh (`rows.ts`), at the world matrix the engine composes for a child of its core parent. A cell
 * that leaves parks its rows; a parent moved rewrites the rows under it. What was written since
 * the last `touched.flush` is what the engine is told.
 */
import { MATRIX_VALUES, multiplyMatrix4 } from '../../../../sdk-core/src/index.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { hostWorldChainInto } from '../../host/world/chain.ts';
import { sameMatrixBits } from '../../host/world/pose.ts';
import type { CellRows } from './cellDecode.ts';
import { createTouchedRows, releaseRow, rowsFree, takeRow, type PlacedMesh } from './rows.ts';

type Placement = { mesh: PlacedMesh; row: number; parent: Object3D; local: Float64Array };

const product = new Float64Array(MATRIX_VALUES);

/** The rows of the cells placed under `root` and the core `parents`, on the rows of `meshes`. */
export function createCellPlacements(
  root: Object3D,
  parents: readonly Object3D[],
  meshes: ReadonlyMap<number, PlacedMesh>,
) {
  const held = new Map<number, Placement[]>();
  /** The world matrix each parent in use had when its rows were written. */
  const worlds = new Map<Object3D, Float64Array>();
  const touched = createTouchedRows();
  const worldOf = (node: Object3D) =>
    worlds.get(node) ?? worlds.set(node, hostWorldChainInto(new Float64Array(16), node)).get(node)!;
  const write = ({ mesh, row, parent, local }: Placement) => {
    multiplyMatrix4(product, worldOf(parent), local);
    for (const link of mesh.links) {
      const rows = link.placements!;
      rows.matrices.set(product, row * 16);
      rows.live[row] = 1;
      touched.touch(link, row);
    }
  };
  return {
    /** The rows of each cell placed. */
    held: held as ReadonlyMap<number, readonly Placement[]>,
    touched,
    /** Places `cell`, whose file is `url`, from its decoded rows; false when a mesh is short. */
    place(cell: number, { nodes, ranks, locals }: CellRows, url: string) {
      if (!rowsFree(meshes, ranks, url)) return false;
      const placements: Placement[] = [];
      for (let node = 0; node < nodes; node++) {
        const parent = ranks[2 * node] < 0 ? root : parents[ranks[2 * node]];
        const mesh = meshes.get(ranks[2 * node + 1])!;
        const local = locals.subarray(MATRIX_VALUES * node, MATRIX_VALUES * (node + 1));
        placements.push({ mesh, row: takeRow(mesh), parent, local });
        write(placements[node]);
      }
      held.set(cell, placements);
      return true;
    },
    /** Parks the rows of `cell`. */
    leave(cell: number) {
      for (const { mesh, row } of held.get(cell)!) {
        releaseRow(mesh, row);
        for (const link of mesh.links) touched.touch(link, row);
      }
      held.delete(cell);
    },
    /** Rewrites the rows under every parent whose world moved since they were written. */
    follow() {
      for (const [node, world] of worlds) {
        hostWorldChainInto(product, node);
        if (sameMatrixBits(world, product)) continue;
        world.set(product);
        for (const placements of held.values())
          for (const placement of placements) if (placement.parent === node) write(placement);
      }
    },
  };
}
