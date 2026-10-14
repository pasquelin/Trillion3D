import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { Seat } from './worldBatches.ts'
import type { LoadedModel } from './loadedModel.ts'
import type { WorldModels } from './worldModels.ts'
import { IDENTITY_MATRIX4 } from '../../../../math/src/matrix/matrix4.ts'
import { NONE, touchRows, type PoseFrame, type PoseState } from './worldPoseState.ts'
import { writeSeat } from './worldPoseSeat.ts'

/**
 * `model`'s rows: the model's world times each mesh's, written and noted for the session — or,
 * the model only moved (`moved`) while it stands linked under the session's composition, its world
 * sent alone, no row written. Written whole, the rows are then linked to the model's world, each
 * at its mesh's own in the graph (`PoseComposer`): the session composes them from then on.
 */
export function writeModel(
  state: PoseState,
  frame: PoseFrame,
  model: LoadedModel,
  shown: boolean,
  moved: boolean,
) {
  const { models, composer } = frame
  if (moved && composer && state.composed.get(model) === shown) {
    composer.link(model, model.matrixWorld.elements, NONE, false)
    return
  }
  // The rows the model's pose writes, each linked at the mesh's own world within its graph once the
  // graph is current: a session is given no matrix (`WorldModels.pose`); without one the rows are
  // written, the pose it opens on.
  let accepted = false
  const draws = models.pose(
    model,
    shown,
    composer &&
      ((rowed) => {
        const links = rowed.rowed.map((source) => ({
          rows: source.rows,
          index: 0,
          local: source.local,
        }))
        if (rowed.world) links.push({ rows: rowed.world.rows, index: 0, local: IDENTITY_MATRIX4 })
        if (!links.length) return
        composer.link(model, model.matrixWorld.elements, links, true)
        accepted = true
      }),
  )
  for (const source of draws?.rowed ?? []) touchRows(state, source, 0, 0)
  if (draws?.world) touchRows(state, draws.world, 0, 0)
  if (accepted) state.composed.set(model, shown)
  else if (state.composed.delete(model)) state.dropped.add(model)
}

/** `model`'s rows written outside a frame's walk (`WorldPoses.writeModel`): the CPU's, whole. A
 *  link the session holds for them is let go at the next walk and made again. */
export function rewriteModel(
  state: PoseState,
  models: WorldModels,
  model: LoadedModel,
  shown: boolean,
) {
  const draws = models.pose(model, shown)
  for (const source of draws?.rowed ?? []) touchRows(state, source, 0, 0)
  if (draws?.world) touchRows(state, draws.world, 0, 0)
  if (state.composed.delete(model)) state.dropped.add(model)
  state.moved.add(model)
}

/**
 * The links of `children` when each is a seated leaf mesh, else null: each child's own local
 * matrix, whose product by the parent's world is the child's world as the transform tree
 * composes it (`refreshNode`), the same factors in the same order.
 */
function linksOf(children: readonly Object3D[], seats: ReadonlyMap<Mesh, Seat>) {
  const links = []
  for (const child of children) {
    const seat = seats.get(child as Mesh)
    if (!seat || !seat.batch.rows || seat.row < 0 || child.children.length) return null
    if ((child as Mesh).primitive === 'sprite') return null
    // A leaf the session composes is not walked by the pass: its pose is brought to its local
    // matrix by this read, the one the link carries.
    void child.worldMatrix
    links.push({ rows: seat.batch.rows, index: seat.row, local: child._matrixElements })
  }
  return links
}

/** Links every child of `node`, drawn or not as `drawn` says, when the session composes them. */
export function linkChildren(
  state: PoseState,
  node: Object3D,
  drawn: boolean,
  { seats, composer }: PoseFrame,
) {
  const links = node.children.length ? linksOf(node.children, seats) : null
  if (links && composer) {
    composer.link(node, node.matrixWorld.elements, links, true)
    state.composed.set(node, drawn)
    // The session composes their worlds: the transform pass walks none of them, a read refreshes.
    for (const child of node.children) child._setWorldLazy(true)
  }
}

/** The leaves of `parent` the session no longer composes are the transform pass's again. */
export function composeEnded(parent: Object3D) {
  if (parent._alive) for (const child of parent.children) child._setWorldLazy(false)
}

/**
 * A composed parent sends its world, its children follow on the GPU; each child that moved on
 * its own has its row written and sends its local matrix. False, the parent dropped, when its own
 * drawn state flipped — every child's flag follows it — or a moved child is no seated leaf any
 * more: its subtree is then written whole.
 */
export function followParent(state: PoseState, node: Object3D, drawn: boolean, frame: PoseFrame) {
  const { seats, composer } = frame
  const children = state.movedUnder.get(node) ?? NONE
  const links = state.composed.get(node) === drawn ? linksOf(children, seats) : null
  if (composer && links) {
    composer.link(node, node.matrixWorld.elements, links, false)
    for (const child of children)
      writeSeat(state, child as Mesh, seats.get(child as Mesh)!, drawn && child.visible)
    return true
  }
  state.composed.delete(node)
  state.dropped.add(node)
  return false
}
