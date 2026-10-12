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
 * A row the session refuses — it says so by name, `content-refused` — is parked, never drawn at a
 * pose this module made. A host mesh whose `castShadow` changed has its rows' flags written again.
 */
import type { PlacementLink } from '../placement/gpuCompose.ts'
import { MATRIX_VALUES, multiplyMatrix4 } from '../../../sdk-core/src/index.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { keepNumbers } from '../../../math/src/vector/vector.ts'
import { resolveCameraWorld } from '../camera/world.ts'
import type { PlacedMesh, createTouchedRows } from './rows.ts'

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
  ) => boolean
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
  /** The frame's world when the parents' were last taken. */
  const framed = new Float64Array(MATRIX_VALUES)
  /** The parent of the composition each core parent is: its rows are linked to it. */
  const slots = new Map<Object3D, object>()
  /** The links the rows a batch wrote are to take, by parent. */
  const pending = new Map<Object3D, PlacementLink[]>()
  const slotWorld = new Float64Array(MATRIX_VALUES),
    product = new Float64Array(MATRIX_VALUES)
  const stale = new Set<Object3D | PlacedMesh>()
  const heldWorld = (node: Object3D) =>
    worlds.get(node) ?? worlds.set(node, resolveCameraWorld(node).worldMatrix.slice()).get(node)!
  /** The world of `parent` in the world the rows stand in: its own, times the frame's. */
  const worldOf = (parent: Object3D) => {
    const own = heldWorld(parent),
      outer = frame.world?.()
    if (!outer) return own
    framed.set(outer)
    return multiplyMatrix4(slotWorld, outer, own)
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
    multiplyMatrix4(product, worldOf(parent), local)
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
      for (const link of mesh.links) list.push({ rows: link.placements!, index: row, local })
    }
    flags(placement)
  }
  /** The session refused, and said so by name: the rows are parked, none drawn at a pose of ours. */
  const refused = (held: Iterable<readonly Placement[]>) => {
    slots.clear()
    pending.clear()
    for (const placements of held)
      for (const { mesh, row } of placements)
        mesh.links.forEach((link) => {
          link.placements!.live[row] = 0
          touched.touch(link, row)
        })
  }
  /** The rows of `parent` among `held`, as links. */
  const under = (held: Iterable<readonly Placement[]>, parent: Object3D) => {
    const links: PlacementLink[] = []
    for (const placements of held)
      for (const at of placements)
        if (at.parent === parent)
          for (const link of at.mesh.links)
            links.push({ rows: link.placements!, index: at.row, local: at.local })
    return links
  }
  /** `parent`'s rows are the session's: its slot made with every row it holds, or given the rows a
   *  batch wrote since; false when the session refuses. */
  const link = (
    parent: Object3D,
    held: Iterable<readonly Placement[]>,
    added?: PlacementLink[],
  ) => {
    const slot = slots.get(parent)
    if (slot) return !added || frame.compose!(slot, worldOf(parent), added, false)
    const made = {}
    if (!frame.compose!(made, worldOf(parent), under(held, parent), true)) return false
    slots.set(parent, made)
    return true
  }
  return {
    write,
    /** The rows `write` took since the last `settle` are linked to their parents; the first rows of
     *  a parent are written as this module writes them, then given to the session. */
    settle(held: Iterable<readonly Placement[]>, parents: Iterable<Object3D>) {
      if (!frame.compose) return
      for (const parent of new Set([...parents, ...pending.keys()])) {
        const added = pending.get(parent)
        if (!link(parent, held, added)) return refused(held)
      }
      pending.clear()
    },
    /** Moves what moved: the parents whose world moved send it alone, and the rows of a session
     *  that does not take them are written again, with those of a mesh whose host meshes' `castShadow`
     *  changed. */
    follow(meshes: Iterable<PlacedMesh>, held: Iterable<readonly Placement[]>) {
      stale.clear()
      // A session that composes now takes the rows placed before it did: one pass over them.
      if (frame.compose && [...worlds.keys()].some((node) => !slots.has(node))) {
        const groups = new Map<Object3D, PlacementLink[]>()
        for (const placements of held)
          for (const at of placements)
            for (const link of at.mesh.links) {
              const list = groups.get(at.parent) ?? groups.set(at.parent, []).get(at.parent)!
              list.push({ rows: link.placements!, index: at.row, local: at.local })
            }
        for (const [parent, links] of groups) {
          if (slots.has(parent)) continue
          const made = {}
          if (!frame.compose(made, worldOf(parent), links, true)) return refused(held)
          slots.set(parent, made)
        }
      }
      for (const mesh of meshes) if (castsMoved(mesh)) stale.add(mesh)
      const outer = frame.world?.(),
        framedMoved = !!outer && !keepNumbers(framed, outer)
      for (const [node, world] of worlds) {
        const now = resolveCameraWorld(node).worldMatrix
        if (!framedMoved && keepNumbers(world, now)) continue
        const slot = frame.compose ? slots.get(node) : undefined
        world.set(now)
        // The slot takes the parent's world alone.
        if (slot && frame.compose!(slot, worldOf(node), [], false)) continue
        if (slot) return refused(held)
      }
      if (framedMoved) framed.set(outer!)
      if (!stale.size) return
      for (const placements of held)
        for (const at of placements)
          if (stale.has(at.parent) || stale.has(at.mesh)) write(at, false)
    },
  }
}
