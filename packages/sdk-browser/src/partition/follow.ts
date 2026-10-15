/**
 * How a partitioned scene gives its cells' nodes their rows (`cells.ts`): each at the world matrix
 * the engine composes for a child of its core parent, shown, and casting as its host mesh says
 * (`castShadow`) — a light cut leaves a shadowless row out. The session composes them
 * (`Engine.composePlacements`): every core parent of the scene is one parent of the composition,
 * its world — its own in the scene's frame, times the frame's, the model's world, when a world
 * draws the scene — sent alone, the rows linked to it each at its node's own matrix.
 * Each frame sends each parent its world as it stands, and the composition alone decides whether
 * it moved (`placement/gpuComposeSlot.ts`): one matrix a parent, no row written, no world held
 * here. A row placed before any composition exists — `prime` places the cells before the engine
 * reads the rows — takes the pose the session opens on, `parent · local`, and is linked at the
 * first frame; from then on this module composes nothing.
 * A host mesh whose `castShadow` changed has its rows' flags written again.
 */
import type { PlacementLink } from '../placement/gpuCompose.ts'
import { writePlacementRow } from '../placement/rows.ts'
import { MATRIX_VALUES } from '../../../math/src/batch/strides.ts'
import { multiplyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { resolveCameraWorld } from '../camera/world.ts'
import type { PlacedMesh, RowLink, createTouchedRows } from './rows.ts'

/** A cell's node on its row: its mesh, the row, the core node it hangs under and its pose there. */
export type Placement = { mesh: PlacedMesh; row: number; parent: Object3D; local: Float64Array }

/**
 * The world a partition's scene hangs in: its model's, when a world draws it (the scene's own
 * nodes stand in the model's frame, never in the world's, `world/core/worldModels.ts`), and the
 * session's composition (`compose`, `Engine.composePlacements`) when it has one.
 */
export type CellFrame = {
  world?: () => Float64Array
  compose?: (
    parent: object,
    world: ArrayLike<number>,
    links: readonly PlacementLink[],
    whole: boolean,
  ) => void
}

/** Whether a host mesh of `mesh` changed its `castShadow` since its rows were written. */
function castsMoved(mesh: PlacedMesh) {
  let moved = false
  mesh.nodes.forEach((node, at) => {
    moved ||= node.castShadow !== mesh.casts[at]
    mesh.casts[at] = node.castShadow
  })
  return moved
}

export function createPlacementWrites(
  touched: ReturnType<typeof createTouchedRows>,
  frame: CellFrame = {},
) {
  /** The core parents in use: the rows hang under them. */
  const parents = new Set<Object3D>()
  /** The parent of the composition each core parent is: its rows are linked to it. */
  const slots = new Map<Object3D, object>()
  /** The links the rows a batch wrote are to take, by parent. */
  const pending = new Map<Object3D, PlacementLink[]>()
  const slotWorld = new Float64Array(MATRIX_VALUES),
    product = new Float64Array(MATRIX_VALUES)
  const stale = new Set<PlacedMesh>()
  /** The world of `parent` in the world the rows stand in: its own now, times the frame's. */
  const worldOf = (parent: Object3D) => {
    const own = resolveCameraWorld(parent).worldMatrix,
      outer = frame.world?.()
    return outer ? multiplyMatrix4(slotWorld, outer, own) : own
  }
  /** The link of row `row` of `link`'s rows at `local`: the one shape a row is linked by. */
  const linkOf = (link: RowLink, row: number, local: Float64Array): PlacementLink => ({
    rows: link.placements!,
    index: row,
    local,
  })
  /** The rows `held` holds under the parents `wanted` names, as links, by parent. */
  const linksByParent = (held: Iterable<readonly Placement[]>, wanted: Set<Object3D>) => {
    const groups = new Map<Object3D, PlacementLink[]>()
    for (const placements of held)
      for (const { mesh, row, parent, local } of placements) {
        if (!wanted.has(parent)) continue
        const list = groups.get(parent) ?? groups.set(parent, []).get(parent)!
        for (const link of mesh.links) list.push(linkOf(link, row, local))
      }
    return groups
  }
  /** The slots of the parents of `opened`, each made with every row `held` holds under it. */
  const openSlots = (opened: Set<Object3D>, held: Iterable<readonly Placement[]>) => {
    const groups = linksByParent(held, opened)
    for (const parent of opened) {
      const made = {}
      frame.compose!(made, worldOf(parent), groups.get(parent) ?? [], true)
      slots.set(parent, made)
    }
  }
  /** Row `placement` on each link of its mesh, by the one row writer (`writePlacementRow`): shown,
   *  casting as its host mesh says, at `pose` when one is given. */
  const writeRow = ({ mesh, row }: Placement, pose: Float64Array | null) =>
    mesh.links.forEach((link, at) => {
      const casts = mesh.nodes[at]?.castShadow !== false
      writePlacementRow(link.placements!, row, pose, true, casts)
      touched.touch(link, row)
    })
  /** Row `placement`: its flags, and — `linking` — its link to its parent, made at the next
   *  `settle`. While no composition exists yet (`prime` places the cells before any engine reads
   *  the rows) it takes the pose the session opens on, `parent · local`; once the session
   *  composes, the row is linked and this module writes no pose. */
  const write = (placement: Placement, linking = true) => {
    const { mesh, row, parent, local } = placement
    parents.add(parent)
    if (!frame.compose) return writeRow(placement, multiplyMatrix4(product, worldOf(parent), local))
    if (linking) {
      const list = pending.get(parent) ?? pending.set(parent, []).get(parent)!
      for (const link of mesh.links) list.push(linkOf(link, row, local))
    }
    writeRow(placement, null)
  }
  /** The parents a `settle` or a `follow` opens slots for. */
  const opening = new Set<Object3D>()
  return {
    write,
    /** The rows `write` took since the last `settle` are linked to their parents: a parent with a
     *  slot is given them, one without has its slot made with every row it holds. */
    settle(held: Iterable<readonly Placement[]>, asked: Iterable<Object3D>) {
      if (!frame.compose) return
      opening.clear()
      for (const parent of asked) if (!slots.has(parent)) opening.add(parent)
      for (const [parent, added] of pending) {
        const slot = slots.get(parent)
        if (slot) frame.compose(slot, worldOf(parent), added, false)
        else opening.add(parent)
      }
      pending.clear()
      if (opening.size) openSlots(opening, held)
    },
    /** Each slot is sent its parent's world as it stands now — the composition alone decides
     *  whether it moved (`settleSlot`) —, a parent in use without a slot (its rows placed before
     *  the session composed) has one made, and the rows of a mesh whose host meshes'
     *  `castShadow` changed have their flags written again. */
    follow(meshes: Iterable<PlacedMesh>, held: Iterable<readonly Placement[]>) {
      if (frame.compose) {
        opening.clear()
        for (const parent of parents) {
          const slot = slots.get(parent)
          if (slot) frame.compose(slot, worldOf(parent), [], false)
          else opening.add(parent)
        }
        if (opening.size) openSlots(opening, held)
      }
      stale.clear()
      for (const mesh of meshes) if (castsMoved(mesh)) stale.add(mesh)
      if (!stale.size) return
      for (const placements of held)
        for (const at of placements) if (stale.has(at.mesh)) write(at, false)
    },
  }
}
