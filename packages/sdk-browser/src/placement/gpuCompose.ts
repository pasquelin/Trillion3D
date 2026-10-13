/**
 * PLACEMENTS COMPOSED ON THE GPU UNDER A MOVED PARENT.
 *
 * A row of an instance buffer whose mesh only follows its parent is linked once: the mesh's own
 * local matrix and the parent's slot. From then on a parent that moves sends one matrix; the worlds
 * pass writes, for every linked root, `parent · local` in exact double arithmetic
 * (`gpuComposeWgsl.ts`) into the roots' double worlds (`rootWorlds.ts`) and its world box; the
 * roots pass carries it into the cut's worlds — the exact translation behind them, which each cut
 * reads at its own eye (`gpu/dag/shader/worldPoseWgsl.ts`) — and the temporal motion; the rows
 * pass derives every word of the root's page-table rows from it (`rowWordsPass.ts`): the very
 * single-precision words the CPU formulas give. The frame hears a pose move as from any engine
 * write (`engineMovedInPlace`): every reader of the scene revision follows; the GPU cut, which
 * compares the CPU worlds it is sent, hears it from the roots pass (`worldsMovedOnGpu`) and cuts
 * again under the composed worlds.
 *
 * The temporal motion of a linked root is the CPU's to the word (`../taa/motion.ts`): the roots pass
 * computes it from the root's composed single-precision world and the one the GPU holds for it at the
 * last accumulated image, as the temporal pass decides this image (`composedMotion.ts`). That
 * decision is a uniform written after the pass is encoded and before the image is submitted, as the
 * CPU motion's own write is: every reader of the motion sees it.
 *
 * The shadows follow a parent's move as they follow a moved node's (`movedBatch.ts`): the box of
 * the slot's linked roots in the parent's frame (`slotBoxes`, the union of each root's local box
 * through its local matrix, made when the links change) is declared at the parent's last world and
 * at its new one, each on its own, the second only when it differs — one box per moved parent, at
 * most two per move, never a row. Its first move makes its roots moving casters, once
 * (`mobility.moveLead`); a later move stales the moving casters alone.
 *
 * Everything a composed world gives is derived on the GPU, the CPU's to the word: the roots pass
 * writes the primitive stretch every cut projects its errors through (`gpuStretchWgsl.ts`); the
 * rows pass each row's sphere, Hi-Z corners and world-dependent levels of detail
 * (`gpuComposeDerivedWgsl.ts`); the members pass the leaf boxes the placement tree is refitted
 * over (`gpu/dag/treeRefit.ts`). The CPU readers — impostor cards, transparent depth, the winding —
 * read the lazy world of the root once a frame, as waves, a soft body and a skeleton do. A link is
 * never refused for what reads its row: the rows no root reads — a blended surface's, or a row
 * whose root is not built yet — are composed for their readers (`composeReaders.ts`).
 */
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import type { PlacementRows } from './rows.ts'
import type { MatrixElements } from '../host/matrixElements.ts'
import { rootRankOfRow } from './update.ts'
import { NONE } from './gpuComposeWgsl.ts'
import { declareSlotMove, holdSlotBox, remakeSlotBox } from './composeBoxes.ts'
import {
  adoptReaders,
  holdReaders,
  readThroughViews,
  releaseReaderViews,
  type ReaderViews,
} from './composeReaders.ts'
import { composeState, linkedRanks, linkRanks, takeSlot, unlinkHeld } from './gpuComposeLinks.ts'
import { settleSlot } from './gpuComposeSlot.ts'
import { installComposedWorld } from './gpuComposeWorld.ts'

/** A row linked to a parent: its rows, its rank there, its mesh's local matrix. */
export type PlacementLink = { rows: PlacementRows; index: number; local: ArrayLike<number> }

const NO_VIEWS: readonly MatrixElements[] = []

/** The views the blended items read rows through (`matrix`), indexed once: what a reader's row is
 *  read through (`composeReaders.ts`). Made only when the readers change, never at a move. */
function readerViews(rt: WebgpuPagesRuntime): ReaderViews {
  const byRows = new Map<PlacementRows, Map<number, MatrixElements[]>>()
  for (const { placement, matrix } of rt.blendState.blendGpu) {
    if (!placement) continue
    const views =
      byRows.get(placement.rows) ?? byRows.set(placement.rows, new Map()).get(placement.rows)!
    const held = views.get(placement.index)
    if (held) held.push(matrix)
    else views.set(placement.index, [matrix])
  }
  return (rows, index) => byRows.get(rows)?.get(index) ?? NO_VIEWS
}

/**
 * Takes `world` as `parent`'s world and links `links` to it. `whole`: they are every row that
 * follows it, any other root it linked follows none any more — no link at all frees its slot —;
 * otherwise they are rows it holds, at a new local matrix. Every link is taken, whatever reads its
 * row (`linkedRanks`). A parent whose world
 * turns its winding has the draw bins of its rows made again from the world the GPU composes
 * (`remakeBins`).
 */
export function composeWebgpuPlacements(
  rt: WebgpuPagesRuntime,
  parent: object,
  world: ArrayLike<number>,
  links: readonly PlacementLink[],
  whole: boolean,
) {
  const { mobility } = rt.lights,
    state = composeState(rt)
  const p = state.parentIds.get(parent)
  if (p === undefined && !links.length) return
  const { ranks, rooted, readers } = linkedRanks(rt, links)
  const slot = takeSlot(state, parent, p, world)
  let views: ReaderViews | undefined
  const viewsOf = () => (views ??= readerViews(rt))
  // The shadow pages the slot's roots cover at the parent's last world: a slot linked now has
  // none of its own, its rows' CPU write in this call declares them (`webgpuPlacements.ts`). The
  // static casters under it stay unless a root it changes is still or its parent's move is a first.
  let movingOnly = true
  holdSlotBox(state, p)
  for (const rank of ranks) movingOnly &&= mobility.moves(rank)
  if (whole) movingOnly = unlinkHeld(rt, state, slot, ranks) && movingOnly
  if (whole && state.readers.has(slot)) releaseReaderViews(state.readers, slot, viewsOf())
  if (whole) state.readers.delete(slot)
  if (readers.length) holdReaders(state.readers, slot, parent, readers, whole)
  if (!ranks.length && !readers.length && whole) {
    state.parentIds.delete(parent)
    state.freeSlots.push(slot)
    declareSlotMove(rt, state, undefined, movingOnly)
    return
  }
  linkRanks(rt, state, { slot, ranks, links: rooted, whole })
  const relinked = ranks.length > 0 || whole
  if (relinked) remakeSlotBox(state, slot)
  settleSlot(rt, state, { slot, p, world, relinked, movingOnly })
  // Its readers' views read their rows composed: a move composes none until one is read.
  if (readers.length || whole) readThroughViews(state.readers, slot, viewsOf(), state)
  // Poses moved and no node entered or left: the frame hears it as any engine pose write.
  rt.run.gate.engineMovedInPlace()
}

/** The roots and the blended items of a growth read views on their new rows (`growth.ts`): the
 *  composed roots carry the refreshing `elements` again, their row holding the world they were last
 *  read at, and the items read their rows through the composition as the views they replace did. */
export function rebindComposedWorlds(rt: WebgpuPagesRuntime) {
  const state = rt.compose
  if (!state) return
  for (let rank = 0; rank < state.roots && rank < rt.layout.selectionRoots.length; rank++)
    if (state.parentOf[rank] !== NONE) installComposedWorld(rt, rank)
  // The rows a root reads now are composed by the roots pass from here on.
  const roots = rt.layout.selectionRoots,
    viewsOf = readerViews(rt)
  for (const slot of state.readers.keys()) readThroughViews(state.readers, slot, viewsOf, state)
  const adopted = adoptReaders(
    state.readers,
    (rows, index) => rootRankOfRow(roots, rows, index),
    viewsOf,
  )
  for (const { slot, parent, readers } of adopted)
    composeWebgpuPlacements(
      rt,
      parent,
      state.worlds.slice(slot * 16, slot * 16 + 16),
      readers,
      false,
    )
}
