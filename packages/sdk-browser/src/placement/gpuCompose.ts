/**
 * PLACEMENTS COMPOSED ON THE GPU UNDER A MOVED PARENT.
 *
 * A row of an instance buffer whose mesh only follows its parent is linked once: the mesh's own
 * local matrix and the parent's slot. From then on a parent that moves sends one matrix; the worlds
 * pass writes, for every linked root, `parent · local` in exact double arithmetic
 * (`gpuComposeWgsl.ts`) into the roots' double worlds (`rootWorlds.ts`); the roots pass carries it
 * into the cut's worlds — the exact translation behind them, which each cut reads at its own eye
 * (`gpu/dag/shader/worldPoseWgsl.ts`) —, and the motion pass into the temporal motion; the rows
 * pass derives every word of the root's page-table rows from it (`rowWordsPass.ts`): the very
 * single-precision words the CPU formulas give. The frame hears a pose move as from any engine
 * write (`engineMovedInPlace`): every reader of the scene revision follows; the GPU cut, which
 * compares the CPU worlds it is sent, hears it from the roots pass (`worldsMovedOnGpu`) and cuts
 * again under the composed worlds.
 *
 * The temporal motion of a linked root is the CPU's to the word (`../taa/motion.ts`): the motion
 * pass computes it from the root's composed single-precision world and the one the GPU holds for it
 * at the last accumulated image, as the temporal pass decides this image (`composedMotionPass.ts`). That
 * decision is a uniform written before the motion pass is encoded into the image's command buffer
 * (`composedMotionPass.ts`), as the CPU motion's own write is: every reader of the motion sees it.
 *
 * The shadows follow a parent's move as they follow a moved node's: the rows pass, deriving the
 * linked roots' rows from the worlds the parent's move composed, stales the pages each row left and
 * entered (`rowCastWgsl.ts`); the CPU declares no box. Its first move makes its roots moving
 * casters, once (`mobility.moveLead`); a later move stales the moving casters alone.
 *
 * Everything a composed world gives is derived on the GPU, the CPU's to the word, as a host's world
 * is: the root boxes pass writes its world box and the primitive stretch every cut projects its
 * errors through (`rootBoxes.ts`); the rows pass each row's sphere, Hi-Z corners and
 * world-dependent levels of detail (`gpuComposeDerivedWgsl.ts`); the tree's leaves pass the leaf
 * boxes the placement tree is refitted over (`treeLeaves.ts`). The CPU readers — impostor cards, transparent depth, the winding —
 * read the lazy world of the root once a frame, as waves, a soft body and a skeleton do. A link is
 * never refused for what reads its row: the rows no root reads — a blended surface's, or a row
 * whose root is not built yet — are composed for their readers (`composeReaders.ts`).
 */
import { MATRIX_VALUES } from '../../../math/src/batch/strides.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import type { PlacementRows } from './rows.ts'
import { rootRankOfRow } from './update.ts'
import { NO_INDEX } from '../../../math/src/constants.ts'
import {
  adoptReaders,
  holdReaders,
  readerViews,
  readThroughViews,
  releaseReaderViews,
  type ReaderViews,
} from './composeReaders.ts'
import { composeState, linkedRanks, linkRanks, takeSlot, unlinkHeld } from './gpuComposeLinks.ts'
import { settleSlot } from './gpuComposeSlot.ts'
import { installComposedWorld } from './gpuComposeWorld.ts'

/** A row linked to a parent: its rows, its rank there, its mesh's local matrix. */
export type PlacementLink = { rows: PlacementRows; index: number; local: ArrayLike<number> }

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
  const state = composeState(rt)
  const p = state.parentIds.get(parent)
  if (p === undefined && !links.length) return
  const { ranks, rooted, readers } = linkedRanks(rt, links)
  const slot = takeSlot(state, parent, p, world)
  let views: ReaderViews | undefined
  const viewsOf = () => (views ??= readerViews(rt.blendState.blendGpu))
  if (whole) {
    unlinkHeld(rt, state, slot, ranks)
    if (state.readers.has(slot)) releaseReaderViews(state.readers, slot, viewsOf())
    state.readers.delete(slot)
  }
  if (readers.length) holdReaders(state.readers, slot, parent, readers)
  if (!ranks.length && !readers.length && whole) {
    state.parentIds.delete(parent)
    state.freeSlots.push(slot)
    return
  }
  linkRanks(rt, state, { slot, ranks, links: rooted, whole })
  const relinked = ranks.length > 0 || whole
  settleSlot(rt, state, { slot, p, world, relinked })
  // Its readers' views read their rows composed: a move composes none until one is read.
  if (readers.length || whole)
    readThroughViews(state.readers, slot, viewsOf(), state, rt.layout.selectionRoots)
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
    if (state.parentOf[rank] !== NO_INDEX) installComposedWorld(rt, rank)
  composeItems(rt, rt.blendState.blendGpu)
}

/** Blended `items` read their rows through the composition, if a parent composes them: called
 *  where an item is made (`growBlend`) and where one stands on a new view (`rebindComposedWorlds`),
 *  so that no item reads a frozen row whatever order a growth runs its steps in. */
export function composeItems(rt: WebgpuPagesRuntime, items: Parameters<typeof readerViews>[0]) {
  const state = rt.compose
  if (!state?.readers.size) return
  const viewsOf = readerViews(items)
  for (const slot of state.readers.keys())
    readThroughViews(state.readers, slot, viewsOf, state, rt.layout.selectionRoots)
}

/** The roots that joined the session (`adoptGrownCut`) take the rows they read from the readers:
 *  the roots pass composes them from now on, linked under the parent their readers followed. */
export function adoptRootedReaders(rt: WebgpuPagesRuntime) {
  const state = rt.compose
  if (!state?.readers.size) return
  const roots = rt.layout.selectionRoots
  const adopted = adoptReaders(
    state.readers,
    (rows, index) => rootRankOfRow(roots, rows, index),
    readerViews(rt.blendState.blendGpu),
  )
  for (const { slot, parent, readers } of adopted)
    composeWebgpuPlacements(
      rt,
      parent,
      state.worlds.slice(slot * MATRIX_VALUES, slot * MATRIX_VALUES + MATRIX_VALUES),
      readers,
      false,
    )
}
