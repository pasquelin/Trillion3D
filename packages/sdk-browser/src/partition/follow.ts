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
import type { PlacementRows } from '../placement/rows.ts'

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

/** A row linked to the frame's world: its rows, its rank there, its world within the frame. */
type FrameLink = { rows: PlacementRows; index: number; local: ArrayLike<number> }

/**
 * The world a partition's scene hangs in: its model's, when a world draws it (the scene's own
 * nodes stand in the model's frame, never in the world's, `world/core/worldModels.ts`), and the
 * session's composition, when it has one (`Engine.composePlacements`): once every row is linked to
 * the frame's world — each at its own within the frame —, a move of the frame sends its world alone
 * and writes no row. `key` is the slot the composition keeps the rows by.
 */
export type CellFrame = {
  world?: () => Float64Array
  compose?: (
    parent: object,
    world: ArrayLike<number>,
    links: readonly FrameLink[],
    whole: boolean,
  ) => boolean
  readonly key?: object
}

export function createPlacementWrites(
  touched: ReturnType<typeof createTouchedRows>,
  frame: CellFrame = {},
) {
  /** The world matrix each parent in use had when its rows were written. */
  const worlds = new Map<Object3D, Float64Array>()
  /** The frame's world when its rows were written. */
  const framed = new Float64Array(MATRIX_VALUES)
  const inner = new Float64Array(MATRIX_VALUES)
  /** Whether every row written is linked to the frame's world: a move of the frame sends its world
   *  alone. False until a move of the frame has written them all and linked them; false again once
   *  the session refuses a link. */
  let linked = false
  /** The links of the rows a batch wrote, their matrices taken from a pool. */
  const pending: FrameLink[] = [],
    pool: Float64Array[] = []
  const stale = new Set<Object3D | PlacedMesh>()
  const heldWorld = (node: Object3D) =>
    worlds.get(node) ?? worlds.set(node, resolveCameraWorld(node).worldMatrix.slice()).get(node)!
  /** The rows the batch wrote are linked — to the slot the first whole call makes, or added to it
   *  — when the session composes the frame. */
  const flush = (whole: boolean) => {
    if (!frame.compose || !frame.world || !(whole || linked) || !pending.length)
      return void (pending.length = 0)
    const accepted = frame.compose(frame.key ?? frame, framed, pending, whole)
    linked = whole ? accepted : linked && accepted
    pending.length = 0
  }
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
      if (world && frame.compose) {
        const local = (pool[pending.length] ??= new Float64Array(MATRIX_VALUES))
        local.set(inner)
        pending.push({ rows, index: row, local })
      }
    })
  }
  const rewrite = (held: Iterable<readonly Placement[]>, only?: (at: Placement) => boolean) => {
    for (const placements of held) for (const at of placements) if (!only || only(at)) write(at)
  }
  return {
    write,
    /** The rows `write` has written since the last `settle` are linked to the frame's world, if
     *  the rows it moves hold them all. */
    settle: () => flush(false),
    /** Writes again the rows of `held` under a parent whose world moved since they were written,
     *  and those of a mesh of `meshes` whose host meshes' `castShadow` changed. */
    follow(meshes: Iterable<PlacedMesh>, held: Iterable<readonly Placement[]>) {
      stale.clear()
      for (const mesh of meshes) if (castsMoved(mesh)) stale.add(mesh)
      for (const [node, world] of worlds)
        if (!keepNumbers(world, resolveCameraWorld(node).worldMatrix)) stale.add(node)
      // The frame moved: its world alone, when the session holds every row linked to it; else every
      // row is written, the frame's times its own, and linked.
      const world = frame.world?.()
      if (world && !keepNumbers(framed, world)) {
        if (linked && frame.compose?.(frame.key ?? frame, world, [], false)) framed.set(world)
        else {
          linked = false
          rewrite(held)
          flush(true)
          return
        }
      }
      if (!stale.size) return
      rewrite(held, (at) => stale.has(at.parent) || stale.has(at.mesh))
      flush(false)
    },
  }
}
