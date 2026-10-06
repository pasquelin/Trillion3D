/**
 * THE ROWS THE PLACED CELLS OF A PARTITION HOLD: each node of a placed cell on a row of its
 * mesh (`rows.ts`), at the world matrix the engine composes for a child of its core parent. A cell
 * that leaves parks its rows; a parent moved, or a host mesh's `castShadow` changed, rewrites the
 * rows under it (`follow.ts`). What was written since the last `touched.flush` is what the engine
 * is told.
 */
import { MATRIX_VALUES } from '../../../sdk-core/src/index.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import type { CellRows } from './cellDecode.ts'
import { createPlacementWrites, type Placement } from './follow.ts'
import { createTouchedRows, releaseRow, rowsFree, takeRow, type PlacedMesh } from './rows.ts'

/** The rows of the cells placed under `root` and the core `parents`, on the rows of `meshes`. */
export function createCellPlacements(
  root: Object3D,
  parents: readonly Object3D[],
  meshes: ReadonlyMap<number, PlacedMesh>,
) {
  const held = new Map<number, Placement[]>()
  const touched = createTouchedRows()
  const { write, follow } = createPlacementWrites(touched)
  return {
    /** The rows of each cell placed. */
    held: held as ReadonlyMap<number, readonly Placement[]>,
    touched,
    /** Places `cell`, whose file is `url`, from its decoded rows; false when a mesh is short. */
    place(cell: number, { nodes, ranks, locals }: CellRows, url: string) {
      if (!rowsFree(meshes, ranks, url)) return false
      const placements: Placement[] = []
      for (let node = 0; node < nodes; node++) {
        const parent = ranks[2 * node] < 0 ? root : parents[ranks[2 * node]]
        const mesh = meshes.get(ranks[2 * node + 1])!
        const local = locals.subarray(MATRIX_VALUES * node, MATRIX_VALUES * (node + 1))
        placements.push({ mesh, row: takeRow(mesh), parent, local })
        write(placements[node])
      }
      held.set(cell, placements)
      return true
    },
    /** Parks the rows of `cell`. */
    leave(cell: number) {
      for (const { mesh, row } of held.get(cell)!) {
        releaseRow(mesh, row)
        for (const link of mesh.links) touched.touch(link, row)
      }
      held.delete(cell)
    },
    /** Rewrites the rows under every parent whose world moved since they were written, and those
     *  of a mesh whose host meshes' `castShadow` changed (`follow.ts`). */
    follow: () => follow(meshes.values(), held.values()),
  }
}
