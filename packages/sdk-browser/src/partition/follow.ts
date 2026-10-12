/**
 * How a partitioned scene writes its cells' nodes on their rows (`cells.ts`): each at the world
 * matrix the engine composes for a child of its core parent, shown, and casting as its host mesh
 * says (`castShadow`) — a light cut leaves a shadowless row out. Before each frame, the rows
 * whose parent's world moved, or whose host mesh's `castShadow` changed, are written again.
 */
import { MATRIX_VALUES, multiplyMatrix4 } from '../../../sdk-core/src/index.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { keepNumbers } from '../../../math/src/vector/vector.ts'
import { resolveCameraWorld } from '../camera/world.ts'
import type { PlacedMesh, createTouchedRows } from './rows.ts'

/** A cell's node on its row: its mesh, the row, the core node it hangs under and its pose there. */
export type Placement = { mesh: PlacedMesh; row: number; parent: Object3D; local: Float64Array }

const product = new Float64Array(MATRIX_VALUES)

/** Whether a host mesh of `mesh` changed its `castShadow` since its rows were written. */
function castsMoved(mesh: PlacedMesh) {
  let moved = false
  mesh.nodes.forEach((node, at) => {
    moved ||= node.castShadow !== mesh.casts[at]
    mesh.casts[at] = node.castShadow
  })
  return moved
}

/** The world a partition's scene hangs in: its model's, when a world draws it. The scene's own
 *  nodes stand in the model's frame, never in the world's (`world/core/worldModels.ts`). */
export type CellFrame = { world?: () => Float64Array }

export function createPlacementWrites(
  touched: ReturnType<typeof createTouchedRows>,
  frame: CellFrame = {},
) {
  /** The world matrix each parent in use had when its rows were written. */
  const worlds = new Map<Object3D, Float64Array>()
  /** The frame's world when its rows were written. */
  const framed = new Float64Array(MATRIX_VALUES)
  const inner = new Float64Array(MATRIX_VALUES)
  const stale = new Set<Object3D | PlacedMesh>()
  const heldWorld = (node: Object3D) =>
    worlds.get(node) ?? worlds.set(node, resolveCameraWorld(node).worldMatrix.slice()).get(node)!
  const write = ({ mesh, row, parent, local }: Placement) => {
    multiplyMatrix4(product, heldWorld(parent), local)
    const world = frame.world?.()
    if (world) {
      inner.set(product)
      multiplyMatrix4(product, world, inner)
      framed.set(world)
    }
    mesh.links.forEach((link, at) => {
      const rows = link.placements!
      rows.matrices.set(product, row * 16)
      rows.live[row] = 1
      rows.shadowless[row] = mesh.nodes[at]?.castShadow === false ? 1 : 0
      touched.touch(link, row)
    })
  }
  return {
    write,
    /** Writes again the rows of `held` under a parent whose world moved since they were written,
     *  and those of a mesh of `meshes` whose host meshes' `castShadow` changed. */
    follow(meshes: Iterable<PlacedMesh>, held: Iterable<readonly Placement[]>) {
      stale.clear()
      for (const mesh of meshes) if (castsMoved(mesh)) stale.add(mesh)
      for (const [node, world] of worlds)
        if (!keepNumbers(world, resolveCameraWorld(node).worldMatrix)) stale.add(node)
      // The frame moved: every row is the frame's times its own.
      const world = frame.world?.()
      if (world && !keepNumbers(framed, world)) {
        for (const placements of held) for (const at of placements) write(at)
        if (!stale.size) return
      }
      if (!stale.size) return
      for (const placements of held)
        for (const at of placements) if (stale.has(at.parent) || stale.has(at.mesh)) write(at)
    },
  }
}
