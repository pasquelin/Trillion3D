/**
 * THE ROWS THE PLACED CELLS OF A PARTITION HOLD: each node of a placed cell on a row of its
 * mesh (`rows.ts`), at the world matrix the engine composes for a child of its core parent, the row
 * knowing its cell and node while it holds them (`rowCells.ts`). A cell
 * that leaves parks its rows; a parent moved, or a host mesh's `castShadow` changed, rewrites the
 * rows under it (`follow.ts`). What was written since the last `touched.flush` is what the engine
 * is told.
 */
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { CellRows } from './cellDecode.ts'
import { createPlacementWrites, type CellFrame, type Placement } from './follow.ts'
import { createTouchedRows, releaseRow, rowsFree, takeRow, type PlacedMesh } from './rows.ts'
import { rowCell, setRowCell } from './rowCells.ts'

/** The rows of the cells placed under `root` and the core `parents`, on the rows of `meshes`. */
export function createCellPlacements(
  root: Object3D,
  parents: readonly Object3D[],
  meshes: ReadonlyMap<number, PlacedMesh>,
  frame: CellFrame,
  /** The placement of its model the partition places cells for: the instance of the world DAG
   *  its rows' objects lie in (`rowCells.ts`). */
  instance: () => number,
) {
  const held = new Map<number, Placement[]>()
  /** The placed cells whose rows draw as their HLOD 0 actor. */
  const proxied = new Set<number>()
  const touched = createTouchedRows()
  const { write, follow, settle } = createPlacementWrites(touched, frame)
  return {
    /** The rows of each cell placed. */
    held: held as ReadonlyMap<number, readonly Placement[]>,
    touched,
    /** Places `cell`, whose file is `url` and whose HLOD 0 cell is `hlod`, from its decoded rows;
     *  false when a mesh is short. */
    place(cell: number, { nodes, ranks, locals }: CellRows, url: string, hlod: number) {
      if (!rowsFree(meshes, ranks, url)) return false
      const placements: Placement[] = []
      for (let node = 0; node < nodes; node++) {
        const parent = ranks[2 * node] < 0 ? root : parents[ranks[2 * node]]
        const mesh = meshes.get(ranks[2 * node + 1])!
        const local = locals.subarray(MATRIX_VALUES * node, MATRIX_VALUES * (node + 1))
        placements.push({ mesh, row: takeRow(mesh), parent, local })
        for (const link of mesh.links)
          setRowCell(link.placements!, placements[node].row, {
            cell,
            node,
            instance: instance(),
            hlod,
            proxy: false,
          })
        write(placements[node])
      }
      held.set(cell, placements)
      settle(
        held.values(),
        placements.map((placement) => placement.parent),
      )
      return true
    },
    /** The rows of `cell` draw as its HLOD 0 actor — `proxy`, its cell past the main grid's
     *  range — or as the source meshes (an instanced HLOD 0 is the same meshes, nothing rebuilt):
     *  rewritten only when that changed. */
    proxy(cell: number, proxy: boolean) {
      const placements = held.get(cell)
      if (!placements || proxied.has(cell) === proxy) return
      if (proxy) proxied.add(cell)
      else proxied.delete(cell)
      for (const { mesh, row } of placements)
        for (const link of mesh.links) {
          const at = rowCell(link.placements!, row)
          if (!at || at.proxy === proxy) continue
          setRowCell(link.placements!, row, { ...at, proxy })
          // Its page rows are written again with the colour of what draws (`linkWorldCell`).
          touched.touch(link, row)
        }
    },
    /** Parks the rows of `cell`. */
    leave(cell: number) {
      for (const { mesh, row } of held.get(cell)!) {
        releaseRow(mesh, row)
        for (const link of mesh.links) {
          setRowCell(link.placements!, row, undefined)
          touched.touch(link, row)
        }
      }
      held.delete(cell)
      proxied.delete(cell)
    },
    /** Rewrites the rows under every parent whose world moved since they were written, and those
     *  of a mesh whose host meshes' `castShadow` changed (`follow.ts`). */
    follow: () => follow(meshes.values(), held.values()),
  }
}
