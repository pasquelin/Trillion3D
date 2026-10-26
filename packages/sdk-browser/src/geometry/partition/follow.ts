/**
 * How a partitioned scene gives its cells' nodes their rows (`cells.ts`): each at the world matrix
 * the engine composes for a child of its core parent, shown, and casting as its host mesh says
 * (`castShadow`) — a light cut leaves a shadowless row out. The session composes them
 * (`Engine.composePlacements`): every core parent of the scene is one parent of the composition,
 * its world — its own in the scene's frame, times the frame's, the model's world, when a world
 * draws the scene — sent alone, the rows linked to it each at its node's own matrix.
 * Each frame sends each parent its world as it stands, and the composition alone decides whether
 * it moved (`placement/compose/gpuComposeSlot.ts`): one matrix a parent, no row written, no world held
 * here. A row placed before any composition exists — `prime` places the cells before the engine
 * reads the rows — takes the pose the session opens on, `parent · local`, and is linked at the
 * first frame; from then on this module composes nothing.
 * A row drawn from an animated core node's own mesh (`PlacedMesh.sources`) is shown only while
 * that mesh is — it and every node above it visible —, the rule a loaded model's mesh follows
 * (`session/world/models/models.ts`). A host mesh whose `castShadow` changed, and a source mesh
 * shown or hidden, have their rows' flags written again: one rewrite of the mesh's rows. While
 * the frame says its rows are hidden (`CellFrame.hidden`: the view only loads the cells and no
 * world DAG's words hide them) every row is written parked, its place kept, and written again as
 * the frame says they draw.
 */
import type { PlacementLink } from '../../placement/compose/gpuCompose.ts'
import { writePlacementRow } from '../../placement/rows/rows.ts'
import {
  FAR_SHADOW_ROOT,
  nodeCasting,
  withCompiledFarTest,
} from '../../visibility/shader/castingMark.ts'
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'
import { appendTo } from '../../../../math/src/sequence/counts.ts'
import { multiplyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { resolveCameraWorld } from '../../camera/world.ts'
import { rootedUnder } from '../../scene/host/world/rooted.ts'
import type { PlacedMesh, RowLink, createTouchedRows } from './rows.ts'

/** A cell's node on its row: its mesh, the row, the core node it hangs under and its pose there. */
export type Placement = {
  mesh: PlacedMesh
  row: number
  parent: Object3D
  local: Float64Array
  /** The row casts far shadows whatever its host mesh says (`CellNode.castFarShadow`). */
  farShadow?: boolean
  /** A sun's far-shadow test reaches the row (`true`) or never does (`false`) unless its host mesh
   *  says (`CellNode.farShadowTest`); left out, the view's rule decides. */
  farShadowTest?: boolean
}

/**
 * The world a partition's scene hangs in: its model's, when a world draws it (the scene's own
 * nodes stand in the model's frame, never in the world's, `session/world/models/models.ts`), and the
 * session's composition (`compose`, `Engine.composePlacements`) when it has one.
 */
export type CellFrame = {
  world?: () => Float64Array
  /** Whether the rows draw nothing, whatever else says: the cells are loaded and not activated. */
  hidden?: boolean
  compose?: (
    parent: object,
    world: ArrayLike<number>,
    links: readonly PlacementLink[],
    whole: boolean,
  ) => void
}

/** Whether a host mesh of `mesh` changed how it casts (`castShadow`, `castFarShadow`, `farShadowTest`) since its
 *  rows were written. */
function castsMoved(mesh: PlacedMesh) {
  let moved = false
  mesh.nodes.forEach((node, at) => {
    const casting = nodeCasting(node)
    moved ||= casting !== mesh.casting[at]
    mesh.casting[at] = casting
  })
  return moved
}

/** Whether row `row` of link `at` of `mesh` is shown: always, unless it is drawn from a source
 *  mesh, then while that mesh and every node above it are visible. */
const sourceShown = (mesh: PlacedMesh, at: number, row: number) => {
  const source = mesh.sources?.[at][row]
  return !source || rootedUnder(source, null, true)
}

/** Whether a row of `mesh` drawn from a source mesh is shown otherwise than its flag says, the
 *  rows being `hidden` or not: that mesh was shown or hidden since the row was written. */
const shownMoved = (mesh: PlacedMesh, hidden: boolean) =>
  !!mesh.sources?.some((column, at) => {
    const { live } = mesh.links[at].placements!
    return column.some(
      (source, row) => !!source && (live[row] === 1) !== (!hidden && sourceShown(mesh, at, row)),
    )
  })

/** Whether each frame's rows were last written hidden. */
const wasHidden = new WeakMap<CellFrame, boolean>()

/** `stale` the meshes of the frame `frame` whose rows are to be written again: a host mesh whose
 *  `castShadow` changed, a source mesh shown or hidden, or every one when the frame's rows flipped
 *  between hidden and drawn since the last call. */
function staleMeshes(frame: CellFrame, stale: Set<PlacedMesh>, meshes: Iterable<PlacedMesh>) {
  const hidden = !!frame.hidden,
    flipped = hidden !== (wasHidden.get(frame) ?? false)
  wasHidden.set(frame, hidden)
  stale.clear()
  // `castsMoved` first: it records each host mesh's flag whatever the sources say.
  for (const mesh of meshes)
    if (castsMoved(mesh) || shownMoved(mesh, hidden) || flipped) stale.add(mesh)
}

/** The link of row `row` of `link`'s rows at `local`: the one shape a row is linked by. */
const linkOf = (link: RowLink, row: number, local: Float64Array): PlacementLink => ({
  rows: link.placements!,
  index: row,
  local,
})

/** The rows `held` holds under the parents `wanted` names, as links, by parent. */
function linksByParent(held: Iterable<readonly Placement[]>, wanted: Set<Object3D>) {
  const groups = new Map<Object3D, PlacementLink[]>()
  for (const placements of held)
    for (const { mesh, row, parent, local } of placements) {
      if (!wanted.has(parent)) continue
      for (const link of mesh.links) appendTo(groups, parent, linkOf(link, row, local))
    }
  return groups
}

/** What the writes keep: the parents in use, their slots, and the links a batch is to take. */
interface Writes {
  touched: ReturnType<typeof createTouchedRows>
  frame: CellFrame
  /** The core parents in use: the rows hang under them. */
  parents: Set<Object3D>
  /** The parent of the composition each core parent is: its rows are linked to it. */
  slots: Map<Object3D, object>
  /** The links the rows a batch wrote are to take, by parent. */
  pending: Map<Object3D, PlacementLink[]>
  slotWorld: Float64Array
  product: Float64Array
  stale: Set<PlacedMesh>
  /** The parents a `settle` or a `follow` opens slots for. */
  opening: Set<Object3D>
}

/** The world of `parent` in the world the rows stand in: its own now, times the frame's. */
const worldOf = (w: Writes, parent: Object3D) => {
  const own = resolveCameraWorld(parent).worldMatrix,
    outer = w.frame.world?.()
  return outer ? multiplyMatrix4(w.slotWorld, outer, own) : own
}

/** The slots of the parents of `opened`, each made with every row `held` holds under it. */
const openSlots = (w: Writes, opened: Set<Object3D>, held: Iterable<readonly Placement[]>) => {
  const groups = linksByParent(held, opened)
  for (const parent of opened) {
    const made = {}
    w.frame.compose!(made, worldOf(w, parent), groups.get(parent) ?? [], true)
    w.slots.set(parent, made)
  }
}

/** Row `placement` on each link of its mesh, by the one row writer (`writePlacementRow`): shown
 *  — while its source mesh is, for a row drawn from one, and the frame does not hide the rows —,
 *  casting as its host mesh says, as far shadows if its node says it casts them and reached by
 *  the far-shadow test as its node says where its host mesh says nothing, at `pose` when one is
 *  given. */
const writeRow = (
  w: Writes,
  { mesh, row, farShadow, farShadowTest }: Placement,
  pose: Float64Array | null,
) =>
  mesh.links.forEach((link, at) => {
    const node = mesh.nodes[at]
    const hosted = (node ? nodeCasting(node) : 0) | (farShadow ? FAR_SHADOW_ROOT : 0)
    const casting = withCompiledFarTest(hosted, farShadowTest)
    const shown = !w.frame.hidden && sourceShown(mesh, at, row)
    writePlacementRow(link.placements!, row, pose, shown, casting)
    w.touched.touch(link, row)
  })

/** Row `placement`: its flags, and — `linking` — its link to its parent, made at the next
 *  `settle`. While no composition exists yet (`prime` places the cells before any engine reads
 *  the rows) it takes the pose the session opens on, `parent · local`; once the session
 *  composes, the row is linked and this module writes no pose. */
const write = (w: Writes, placement: Placement, linking = true) => {
  const { mesh, row, parent, local } = placement
  w.parents.add(parent)
  if (!w.frame.compose)
    return writeRow(w, placement, multiplyMatrix4(w.product, worldOf(w, parent), local))
  if (linking) {
    const list = w.pending.get(parent) ?? w.pending.set(parent, []).get(parent)!
    for (const link of mesh.links) list.push(linkOf(link, row, local))
  }
  writeRow(w, placement, null)
}

const settleWrites = (
  w: Writes,
  held: Iterable<readonly Placement[]>,
  asked: Iterable<Object3D>,
) => {
  const { frame, slots, opening, pending } = w
  if (!frame.compose) return
  opening.clear()
  for (const parent of asked) if (!slots.has(parent)) opening.add(parent)
  for (const [parent, added] of pending) {
    const slot = slots.get(parent)
    if (slot) frame.compose(slot, worldOf(w, parent), added, false)
    else opening.add(parent)
  }
  pending.clear()
  if (opening.size) openSlots(w, opening, held)
}

const followWrites = (
  w: Writes,
  meshes: Iterable<PlacedMesh>,
  held: Iterable<readonly Placement[]>,
) => {
  const { frame, slots, opening, stale } = w
  if (frame.compose) {
    opening.clear()
    for (const parent of w.parents) {
      const slot = slots.get(parent)
      if (slot) frame.compose(slot, worldOf(w, parent), [], false)
      else opening.add(parent)
    }
    if (opening.size) openSlots(w, opening, held)
  }
  staleMeshes(frame, stale, meshes)
  if (!stale.size) return
  for (const placements of held)
    for (const at of placements) if (stale.has(at.mesh)) write(w, at, false)
}

export function createPlacementWrites(
  touched: ReturnType<typeof createTouchedRows>,
  frame: CellFrame = {},
) {
  const w: Writes = {
    touched,
    frame,
    parents: new Set<Object3D>(),
    slots: new Map<Object3D, object>(),
    pending: new Map<Object3D, PlacementLink[]>(),
    slotWorld: new Float64Array(MATRIX_VALUES),
    product: new Float64Array(MATRIX_VALUES),
    stale: new Set<PlacedMesh>(),
    opening: new Set<Object3D>(),
  }
  return {
    write: (placement: Placement, linking = true) => write(w, placement, linking),
    /** The rows `write` took since the last `settle` are linked to their parents: a parent with a
     *  slot is given them, one without has its slot made with every row it holds. */
    settle: (held: Iterable<readonly Placement[]>, asked: Iterable<Object3D>) =>
      settleWrites(w, held, asked),
    /** Each slot is sent its parent's world as it stands now — the composition alone decides
     *  whether it moved (`settleSlot`) —, a parent in use without a slot (its rows placed before
     *  the session composed) has one made, and the rows of a mesh whose host meshes'
     *  `castShadow` changed, or one of whose source meshes was shown or hidden, or every one once
     *  the frame hid the rows or stopped hiding them, have their flags written again. */
    follow: (meshes: Iterable<PlacedMesh>, held: Iterable<readonly Placement[]>) =>
      followWrites(w, meshes, held),
  }
}
