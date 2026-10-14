import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { updateTransformTree } from '../../../../sdk-core/src/world/transform-tree/pass.ts'
import type { PlacementRows } from '../../placement/rows.ts'
import type { Batch, Seat } from './worldBatches.ts'
import type { LoadedModel } from './loadedModel.ts'
import type { WorldModels } from './worldModels.ts'
import { chainShown, rootedUnder } from '../../host/world/rooted.ts'
import { writeModelNode } from './modelNodes.ts'
import {
  NONE,
  touchRows,
  type PoseComposer,
  type PoseFrame,
  type PoseState,
  type RowsOwner,
} from './worldPoseState.ts'
import { writeSeat } from './worldPoseSeat.ts'
import {
  composeEnded,
  followParent,
  linkChildren,
  rewriteModel,
  writeModel,
} from './worldPoseLinks.ts'

/** Whether `node` is a loaded model. */
const isModel = (node: Object3D): node is LoadedModel =>
  (node as LoadedModel).isLoadedModel === true

/** The loaded model `node` is, or is a node of. */
function modelOf(node: Object3D) {
  for (let walk: Object3D | null = node; walk; walk = walk.parent) if (isModel(walk)) return walk
  return undefined
}

/**
 * The per-frame change list of a world: the nodes whose pose or visibility moved since the last
 * frame, and the rows those writes touched. `apply` runs once before a frame: the transform tree's
 * frame pass brings every changed world matrix up to date (`pass.ts`), each node once, then the
 * moved nodes have their subtrees' rows and their models' written — a node under another moved node is
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
  const state: PoseState = {
    moved: new Set(),
    ranges: new Map(),
    composed: new Map(),
    dropped: new Set(),
    movedUnder: new Map(),
    composedKey: undefined,
    composedEpoch: -1,
  }
  const touchRange = (owner: RowsOwner, from: number, to: number) =>
    touchRows(state, owner, from, to)
  return {
    touch: (batch: Batch, row: number) => touchRange(batch, row, row),
    /** Every row of `model`'s meshes written from the model as it stands (`WorldModels.pose`). */
    writeModel: (models: WorldModels, model: LoadedModel, shown: boolean) =>
      rewriteModel(state, models, model, shown),
    touchRange,
    writeSeat: (mesh: Mesh, seat: Seat, shown: boolean) => writeSeat(state, mesh, seat, shown),
    /** A node's pose, visibility or `castShadow` moved: it and its subtree are written before the
     *  next frame. */
    moved(node: Object3D) {
      state.moved.add(node)
    },
    get pending() {
      return state.moved.size > 0 || state.ranges.size > 0
    },
    /** Writes what moved, then hands every touched range to `send`. */
    apply(
      scene: Object3D,
      seats: ReadonlyMap<Mesh, Seat>,
      models: WorldModels,
      send: (rows: PlacementRows, from: number, to: number) => void,
      composer?: PoseComposer,
    ) {
      relink(state, composer)
      if (state.moved.size) writeMoved(state, scene, { seats, models, composer })
      sendRanges(state, send, composer)
    },
    /** A session about to open reads every row as written: no range is left to send it. */
    settle() {
      state.ranges.clear()
    },
  }
}

/** Writes the rows of `node`'s subtree. A composed parent sends its world instead
 *  (`followParent`); one dropped is written whole and linked again, as `link` asks of `node`. */
function writeSubtree(
  state: PoseState,
  node: Object3D,
  shown: boolean,
  frame: PoseFrame,
  link: boolean,
) {
  const drawn = shown && node.visible
  const seat = frame.seats.get(node as Mesh)
  if (seat) writeSeat(state, node as Mesh, seat, drawn)
  // A model's rows are linked under the model itself (`writeModel`); its children are written
  // as any node's, no composition of theirs beside it.
  const model = isModel(node)
  if (model) writeModel(state, frame, node, drawn, true)
  const linked = !model && state.composed.has(node)
  if (linked && followParent(state, node, drawn, frame)) return
  for (const child of node.children) writeSubtree(state, child, drawn, frame, false)
  if (!model && frame.composer && (link || linked)) linkChildren(state, node, drawn, frame)
}

/** Another session or another seating holds none of the links: the composed parents' rows are
 *  written whole again, and linked anew where they still may be. */
function relink(state: PoseState, composer: PoseComposer | undefined) {
  const { composed } = state
  if (
    composed.size &&
    (composer?.key !== state.composedKey || composer?.epoch !== state.composedEpoch)
  ) {
    for (const parent of composed.keys()) {
      state.moved.add(parent)
      state.dropped.add(parent)
      if (!isModel(parent)) composeEnded(parent)
    }
    composed.clear()
  }
  state.composedKey = composer?.key
  state.composedEpoch = composer?.epoch ?? -1
}

/** Writes every moved node's subtree, once, after the transform tree's frame pass. */
function writeMoved(state: PoseState, scene: Object3D, frame: PoseFrame) {
  const { moved, movedUnder, composed } = state
  updateTransformTree(Object3D._treeOf(scene))
  // A child of a composed parent is written through it: the parent sends its world, the
  // child's row and link follow (`followParent`).
  for (const node of moved) {
    const parent = node._alive ? node.parent : null
    // A model's rows are linked under it, its children's moves are no parent's (`writeModel`).
    if (!parent || !composed.has(parent) || isModel(parent)) continue
    const children = movedUnder.get(parent)
    if (children) children.push(node)
    else movedUnder.set(parent, [node])
  }
  for (const parent of movedUnder.keys()) moved.add(parent)
  const posed = new Set<LoadedModel>()
  for (const node of moved) {
    if (!node._alive) continue
    // A node of a loaded model is drawn from its graph node, which holds its local pose:
    // each moved node is written there, its subtree follows in the graph.
    writeModelNode(node)
    const model = modelOf(node)
    if (model && model !== node) posed.add(model)
    const shown = chainShown(node, scene, moved)
    if (shown === null) continue
    writeSubtree(state, node, shown, frame, node !== scene)
  }
  // A model whose node moved is posed once, the node's write in its graph read by its rows.
  for (const model of posed) writeModel(state, frame, model, rootedUnder(model, scene, true), false)
  moved.clear()
  movedUnder.clear()
}

/** Unlinks every parent dropped and not linked again, then hands each touched range to `send`. */
function sendRanges(
  state: PoseState,
  send: (rows: PlacementRows, from: number, to: number) => void,
  composer: PoseComposer | undefined,
) {
  // A parent dropped and not linked again: every row it held is the CPU's, written above. The
  // unlink reads no world: a parent destroyed since it was linked is unlinked all the same.
  for (const parent of state.dropped)
    if (!state.composed.has(parent)) {
      composer?.link(parent, NONE, NONE, true)
      if (!isModel(parent)) composeEnded(parent)
    }
  state.dropped.clear()
  for (const [batch, range] of state.ranges)
    if (batch.rows === range.rows) send(range.rows, range.from, range.to)
  state.ranges.clear()
}
