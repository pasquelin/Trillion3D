/**
 * How a partitioned scene gives its cells' nodes their rows (`cells.ts`): each at the world matrix
 * the engine composes for a child of its core parent, shown, and casting as its host mesh says
 * (`castShadow`) — a light cut leaves a shadowless row out. The session composes them
 * (`Engine.composePlacements`): every core parent of the scene is one parent of the composition,
 * its world — its own in the scene's frame, times the frame's, the model's world, when a world
 * draws the scene — sent alone when it moves, the rows linked to it each at its node's own matrix.
 * One matrix a moved parent, no row written. A row placed before any composition exists — `prime`
 * places the cells before the engine reads the rows — takes the pose the session opens on,
 * `parent · local`, and is linked at the first frame; from then on this module composes nothing.
 * A host mesh whose `castShadow` changed has its rows' flags written again.
 */
import type { PlacementLink } from '../placement/gpuCompose.ts'
import { MATRIX_VALUES } from '../../../sdk-core/src/index.ts'
import { composeWorld } from '../placement/composeWorld.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { keepNumbers } from '../../../math/src/vector/vector.ts'
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
  /** The world each core parent in use had, in its own frame, when its world was last taken. */
  const worlds = new Map<Object3D, Float64Array>()
  /** The frame's world the slots were last sent at: written by `follow` alone, which compares it. */
  const framed = new Float64Array(MATRIX_VALUES)
  /** The parent of the composition each core parent is: its rows are linked to it. */
  const slots = new Map<Object3D, object>()
  /** The core parents in use that no slot holds yet: the rows placed before a composition was. */
  const unslotted = new Set<Object3D>()
  /** The slots made by the `follow` under way, at the frame's world it reads: none is sent again. */
  const fresh = new Set<Object3D>()
  /** The links the rows a batch wrote are to take, by parent. */
  const pending = new Map<Object3D, PlacementLink[]>()
  const slotWorld = new Float64Array(MATRIX_VALUES),
    product = new Float64Array(MATRIX_VALUES)
  const stale = new Set<Object3D | PlacedMesh>()
  const heldWorld = (node: Object3D) => {
    let world = worlds.get(node)
    if (world) return world
    worlds.set(node, (world = resolveCameraWorld(node).worldMatrix.slice()))
    if (!slots.has(node)) unslotted.add(node)
    return world
  }
  /** The world of `parent` in the world the rows stand in: its own, times the frame's. */
  const worldOf = (parent: Object3D) => {
    const own = heldWorld(parent),
      outer = frame.world?.()
    return outer ? composeWorld(slotWorld, outer, own) : own
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
  /** The slots of the parents of `parents`, each made with every row `held` holds under it. */
  const openSlots = (parents: Set<Object3D>, held: Iterable<readonly Placement[]>) => {
    const groups = linksByParent(held, parents)
    for (const parent of parents) {
      const made = {}
      frame.compose!(made, worldOf(parent), groups.get(parent) ?? [], true)
      slots.set(parent, made)
      unslotted.delete(parent)
    }
  }
  const flags = ({ mesh, row }: Placement) =>
    mesh.links.forEach((link, at) => {
      const rows = link.placements!
      rows.live[row] = 1
      rows.shadowless[row] = mesh.nodes[at]?.castShadow === false ? 1 : 0
      touched.touch(link, row)
    })
  /** The pose a row opens the session on, `parent · local`: written only while no composition
   *  exists to give it (`prime` places the cells before any engine reads the rows). Once the
   *  session composes, the row is linked and this module writes none. */
  const writeOpeningPose = (placement: Placement) => {
    const { mesh, row, parent, local } = placement
    composeWorld(product, worldOf(parent), local)
    for (const link of mesh.links) link.placements!.matrices.set(product, row * 16)
  }
  /** Row `placement`: its flags, and — `linking` — its link to its parent, made at the next `settle`;
   *  its opening pose while no composition exists yet. */
  const write = (placement: Placement, linking = true) => {
    const { mesh, row, parent, local } = placement
    heldWorld(parent)
    if (!frame.compose) writeOpeningPose(placement)
    else if (linking) {
      const list = pending.get(parent) ?? pending.set(parent, []).get(parent)!
      for (const link of mesh.links) list.push(linkOf(link, row, local))
    }
    flags(placement)
  }
  /** The parents a `settle` opens slots for. */
  const opening = new Set<Object3D>()
  return {
    write,
    /** The rows `write` took since the last `settle` are linked to their parents: a parent with a
     *  slot is given them, one without has its slot made with every row it holds. */
    settle(held: Iterable<readonly Placement[]>, parents: Iterable<Object3D>) {
      if (!frame.compose) return
      opening.clear()
      for (const parent of parents) if (!slots.has(parent)) opening.add(parent)
      for (const [parent, added] of pending) {
        const slot = slots.get(parent)
        if (slot) frame.compose(slot, worldOf(parent), added, false)
        else opening.add(parent)
      }
      pending.clear()
      if (opening.size) openSlots(opening, held)
    },
    /** Moves what moved: the parents whose world moved send it alone, and the rows of a mesh whose
     *  host meshes' `castShadow` changed have their flags written again. */
    follow(meshes: Iterable<PlacedMesh>, held: Iterable<readonly Placement[]>) {
      stale.clear()
      fresh.clear()
      // Read before any slot is made: what every slot was sent at is the one thing it says.
      const outer = frame.world?.(),
        framedMoved = !!outer && !keepNumbers(framed, outer)
      // A session that composes now takes the rows placed before it did: one pass over them, at
      // the frame's world just read.
      if (frame.compose && unslotted.size) {
        for (const parent of unslotted) fresh.add(parent)
        openSlots(fresh, held)
      }
      for (const mesh of meshes) if (castsMoved(mesh)) stale.add(mesh)
      for (const [node, world] of worlds) {
        const now = resolveCameraWorld(node).worldMatrix
        if (keepNumbers(world, now) && (!framedMoved || fresh.has(node))) continue
        const slot = frame.compose ? slots.get(node) : undefined
        // The slot takes the parent's world alone.
        if (slot) frame.compose!(slot, worldOf(node), [], false)
      }
      if (!stale.size) return
      for (const placements of held)
        for (const at of placements)
          if (stale.has(at.parent) || stale.has(at.mesh)) write(at, false)
    },
  }
}
