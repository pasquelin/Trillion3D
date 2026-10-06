import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { updateTransformTree } from '../../../../sdk-core/src/math/transform-tree/pass.ts'
import type { PlacementRows } from '../../placement/rows.ts'
import type { Batch, Seat } from './worldBatches.ts'
import { copyElements } from '../../math/matrixElements.ts'
import { rootedUnder } from '../../host/world/rooted.ts'
import { writeModelNode } from './modelNodes.ts'
import { hypot3 } from '../../../../sdk-core/src/math/primitives/hypot.ts'

/** Rows a session composes on the GPU under their parent (`placement/gpuCompose.ts`). */
export type PoseComposer = {
  /** The session: another one holds no link. */
  key: object
  /** The seat epoch: a seat that may have changed drops every link. */
  epoch: number
  /**
   * `parent`'s world is `world`, and rows `links` follow it, each at its local matrix — views read
   * during the call, never kept. `whole`: they are every row that follows it, any other it held is
   * the CPU's again — none at all unlinks it, its world unread —; otherwise they are children that
   * moved on their own under a parent it holds. False when it cannot: the caller writes the rows
   * itself.
   */
  link(
    parent: object,
    world: ArrayLike<number>,
    links: readonly { rows: PlacementRows; index: number; local: ArrayLike<number> }[],
    whole: boolean,
  ): boolean
}

const NONE: readonly never[] = []

/** A loaded model, drawn whole through a host node posed by its world matrix alone
 *  (`worldMirror.ts`). */
export type PosedTwin = {
  matrixAutoUpdate: boolean
  visible: boolean
  matrix: { elements: { [index: number]: number } }
}

/** A sprite's row, rewritten at every write (`spriteRow`). */
const spriteScratch = new Float64Array(16)

/**
 * The row of a sprite: where it stands and its scale on `x` and `y`, all the rasters read of it
 * (`spriteAt`), never its turn — a sprite is drawn by its position and its axes'
 * lengths alone. Its third axis, which no raster reads, is `(m − x, m − y, m)`, `m` the larger
 * scale: the cube of its pages (`runtimePrimitive.ts`), of half-width `r`, then spans `r·m` on
 * every axis of the world — the farthest a corner lies from the origin once scaled, whichever way
 * the camera or the material's rotation turns it, a long side laid along any world axis included.
 */
function spriteRow(world: ArrayLike<number>) {
  const x = hypot3(world[0], world[1], world[2]),
    y = hypot3(world[4], world[5], world[6]),
    m = Math.max(x, y)
  spriteScratch.fill(0)
  spriteScratch[0] = x
  spriteScratch[5] = y
  spriteScratch[8] = m - x
  spriteScratch[9] = m - y
  spriteScratch[10] = m
  for (let i = 12; i < 15; i++) spriteScratch[i] = world[i]
  spriteScratch[15] = 1
  return spriteScratch
}

/** True when `node` is drawn: rooted under `scene`, and it and every ancestor visible. */
export const shownUnder = (node: Object3D, scene: Object3D) => rootedUnder(node, scene, true)

/**
 * Whether the rows under moved `node` are drawn — the scene itself, or every ancestor visible up
 * to `scene` (`shownUnder` of its parent) —, or `null` when an ancestor moved too: that one's
 * subtree writes `node`'s rows, once. One climb; a bone under a moved bone stops at its parent.
 */
function chainShown(node: Object3D, scene: Object3D, moved: ReadonlySet<Object3D>) {
  let shown: boolean | undefined = node === scene || undefined
  for (let up = node.parent; up; up = up.parent) {
    if (moved.has(up)) return null
    if (shown === undefined && !up.visible) shown = false
    else if (shown === undefined && up === scene) shown = true
  }
  return shown ?? false
}

/**
 * The per-frame change list of a world: the nodes whose pose or visibility moved since the last
 * frame, and the rows those writes touched. `apply` runs once before a frame: the transform tree's
 * frame pass brings every changed world matrix up to date (`pass.ts`), each node once, then the
 * moved nodes have their subtrees' rows and twins written — a node under another moved node is
 * written with it, never twice (`chainShown`) —, and the touched range of each instance buffer is
 * handed to the session in one call. A frame with nothing moved does nothing.
 *
 * A parent whose children are all seated leaf meshes may have them composed by the session on the
 * GPU (`PoseComposer`): it then sends its world instead of writing their matrices. Their flags are
 * still written into their rows, by the one write any row takes (`writeSeat`): a child that moved
 * on its own — its pose, its visibility, its casting — is written as any seat is, and the session
 * parks, takes or marks it from that write as it does every row.
 */
export function createWorldPoses() {
  const moved = new Set<Object3D>()
  const ranges = new Map<Batch, { rows: PlacementRows; from: number; to: number }>()
  /** Rows `from`..`to` of a batch were written: the range sent before the next frame grows. */
  const touchRange = (batch: Batch, from: number, to: number) => {
    if (!batch.rows) return
    const range = ranges.get(batch)
    if (range && range.rows === batch.rows) {
      range.from = Math.min(range.from, from)
      range.to = Math.max(range.to, to)
    } else ranges.set(batch, { rows: batch.rows, from, to })
  }
  const touch = (batch: Batch, row: number) => touchRange(batch, row, row)
  /** Parents whose children the session composes, and whether each parent was drawn. */
  const composed = new Map<Object3D, boolean>()
  /** Parents taken out of `composed` during an `apply`: unlinked at its end unless linked again. */
  const dropped = new Set<Object3D>()
  /** The children of each composed parent that moved on their own, gathered by `apply`. */
  const movedUnder = new Map<Object3D, Object3D[]>()
  let composedKey: object | undefined,
    composedEpoch = -1
  /**
   * The links of `children` when each is a seated leaf mesh, else null: each child's own local
   * matrix, whose product by the parent's world is the child's world as the transform tree
   * composes it (`refreshNode`), the same factors in the same order.
   */
  const linksOf = (children: readonly Object3D[], seats: ReadonlyMap<Mesh, Seat>) => {
    const links = []
    for (const child of children) {
      const seat = seats.get(child as Mesh)
      if (!seat || !seat.batch.rows || seat.row < 0 || child.children.length) return null
      if ((child as Mesh).primitive === 'sprite') return null
      links.push({ rows: seat.batch.rows, index: seat.row, local: child._matrixElements })
    }
    return links
  }
  /** Writes one seated mesh's world matrix — a sprite's row (`spriteRow`) — and flags into its
   *  row: whether it is shown, and whether it casts no shadow. */
  const writeSeat = (mesh: Mesh, seat: Seat, shown: boolean) => {
    const rows = seat.batch.rows
    if (!rows || seat.row < 0) return
    const world = mesh.matrixWorld.elements
    rows.matrices.set(mesh.primitive === 'sprite' ? spriteRow(world) : world, seat.row * 16)
    rows.live[seat.row] = shown ? 1 : 0
    rows.shadowless[seat.row] = mesh.castShadow ? 0 : 1
    touch(seat.batch, seat.row)
  }
  const writeTwin = (node: Object3D, twin: PosedTwin, shown: boolean) => {
    copyElements(twin.matrix.elements, node.matrixWorld.elements)
    twin.matrixAutoUpdate = false
    twin.visible = shown
  }
  /** Links every child of `node`, drawn or not as `drawn` says, when the session composes them. */
  const linkChildren = (
    node: Object3D,
    drawn: boolean,
    seats: ReadonlyMap<Mesh, Seat>,
    composer: PoseComposer,
  ) => {
    const links = node.children.length ? linksOf(node.children, seats) : null
    if (links && composer.link(node, node.matrixWorld.elements, links, true))
      composed.set(node, drawn)
  }
  /**
   * A composed parent sends its world, its children follow on the GPU; each child that moved on
   * its own has its row written and sends its local matrix. False, the parent dropped, when its own
   * drawn state flipped — every child's flag follows it —, a moved child is no seated leaf any
   * more, or the session refuses: its subtree is then written whole.
   */
  const followParent = (
    node: Object3D,
    drawn: boolean,
    seats: ReadonlyMap<Mesh, Seat>,
    composer: PoseComposer | undefined,
  ) => {
    const children = movedUnder.get(node) ?? NONE
    const links = composed.get(node) === drawn ? linksOf(children, seats) : null
    if (composer && links && composer.link(node, node.matrixWorld.elements, links, false)) {
      for (const child of children)
        writeSeat(child as Mesh, seats.get(child as Mesh)!, drawn && child.visible)
      return true
    }
    composed.delete(node)
    dropped.add(node)
    return false
  }
  /** Writes the rows and twins of `node`'s subtree. A composed parent sends its world instead
   *  (`followParent`); one dropped is written whole and linked again, as `link` asks of `node`. */
  const writeSubtree = (
    node: Object3D,
    shown: boolean,
    seats: ReadonlyMap<Mesh, Seat>,
    twins: ReadonlyMap<Object3D, PosedTwin>,
    composer: PoseComposer | undefined,
    link: boolean,
  ) => {
    const drawn = shown && node.visible
    const seat = seats.get(node as Mesh)
    if (seat) writeSeat(node as Mesh, seat, drawn)
    const twin = twins.get(node)
    if (twin) writeTwin(node, twin, drawn)
    const linked = composed.has(node)
    if (linked && followParent(node, drawn, seats, composer)) return
    for (const child of node.children) writeSubtree(child, drawn, seats, twins, composer, false)
    if (composer && (link || linked)) linkChildren(node, drawn, seats, composer)
  }
  return {
    touch,
    touchRange,
    writeSeat,
    writeTwin,
    /** A node's pose, visibility or `castShadow` moved: it and its subtree are written before the
     *  next frame. */
    moved(node: Object3D) {
      moved.add(node)
    },
    get pending() {
      return moved.size > 0 || ranges.size > 0
    },
    /** Writes what moved, then hands every touched range to `send`. */
    apply(
      scene: Object3D,
      seats: ReadonlyMap<Mesh, Seat>,
      twins: ReadonlyMap<Object3D, PosedTwin>,
      send: (rows: PlacementRows, from: number, to: number) => void,
      composer?: PoseComposer,
    ) {
      // Another session or another seating holds none of the links: the composed parents' rows
      // are written whole again, and linked anew where they still may be.
      if (composed.size && (composer?.key !== composedKey || composer?.epoch !== composedEpoch)) {
        for (const parent of composed.keys()) {
          moved.add(parent)
          dropped.add(parent)
        }
        composed.clear()
      }
      composedKey = composer?.key
      composedEpoch = composer?.epoch ?? -1
      if (moved.size) {
        updateTransformTree(Object3D._treeOf(scene))
        // A child of a composed parent is written through it: the parent sends its world, the
        // child's row and link follow (`followParent`).
        for (const node of moved) {
          const parent = node._alive ? node.parent : null
          if (!parent || !composed.has(parent)) continue
          const children = movedUnder.get(parent)
          if (children) children.push(node)
          else movedUnder.set(parent, [node])
        }
        for (const parent of movedUnder.keys()) moved.add(parent)
        for (const node of moved) {
          if (!node._alive) continue
          // A node of a loaded model is drawn from its graph node, which holds its local pose:
          // each moved node is written there, its subtree follows in the graph.
          writeModelNode(node)
          const shown = chainShown(node, scene, moved)
          if (shown === null) continue
          writeSubtree(node, shown, seats, twins, composer, node !== scene)
        }
        moved.clear()
        movedUnder.clear()
      }
      // A parent dropped and not linked again: every row it held is the CPU's, written above. The
      // unlink reads no world: a parent destroyed since it was linked is unlinked all the same.
      for (const parent of dropped)
        if (!composed.has(parent)) composer?.link(parent, NONE, NONE, true)
      dropped.clear()
      for (const [batch, range] of ranges)
        if (batch.rows === range.rows) send(range.rows, range.from, range.to)
      ranges.clear()
    },
    /** A session about to open reads every row as written: no range is left to send it. */
    settle() {
      ranges.clear()
    },
  }
}
