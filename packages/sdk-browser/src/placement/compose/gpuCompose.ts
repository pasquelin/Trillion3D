/**
 * PLACEMENTS COMPOSED ON THE GPU UNDER A MOVED PARENT.
 *
 * A row of an instance buffer whose mesh only follows its parent is linked once: the mesh's own
 * local matrix and the parent's slot. From then on a parent that moves sends one matrix; the worlds
 * pass writes, for every linked root, `parent · local` in exact double arithmetic
 * (`gpuComposeWgsl.ts`) into the roots' double worlds (`../roots/rootWorlds.ts`); the roots pass carries it
 * into the cut's worlds — the exact translation behind them, which each cut reads at its own eye
 * (`geometry/dag/shader/worldPoseWgsl.ts`) —; the decode
 * of the visible clusters (`../../visibility/decode/decodeWgsl.ts`) writes the world of each from
 * it: the very single-precision words the CPU formulas give. The frame hears a pose move as from any engine
 * write (`engineMovedInPlace`): every reader of the scene revision follows; the GPU cut, which
 * compares the CPU worlds it is sent, hears it from the roots pass (`worldsMovedOnGpu`) and cuts
 * again under the composed worlds.
 *
 * The temporal motion of a linked root is any placement's: the roots pass names the poses it moved
 * to the poses the next drawn frame keeps (`worldsMovedOnGpu`, `geometry/dag/previousPoses.ts`), and
 * the velocity measures `previous · current⁻¹` of the two (`../../post/taa/nearestSurfaceWgsl.ts`).
 *
 * The shadows follow a parent's move as they follow a moved node's: the CPU declares no box. Its
 * first move makes its roots moving casters, once (`mobility.moveLead`).
 *
 * Everything a composed world gives is derived on the GPU, the CPU's to the word, as a host's world
 * is: the root boxes pass writes its world box and the primitive stretch every cut projects its
 * errors through (`../roots/rootBoxes.ts`); the decode of the visible clusters each cluster's world
 * (`../../visibility/decode/decodeWgsl.ts`); the tree's leaves pass the leaf
 * boxes the placement tree is refitted over (`../tree/treeLeaves.ts`). The CPU readers — transparent depth,
 * the winding — read the lazy world of the root once a frame, as waves, a soft body and a skeleton
 * do. A link is never refused for what reads its row: the rows no root reads — a blended surface's,
 * or a row whose root is not built yet — are composed for their readers (`composeReaders.ts`).
 */
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { PlacementRows } from '../rows/rows.ts'
import { rootRankOfRow } from '../update.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import {
  adoptReaders,
  holdReaders,
  readerViews,
  readThroughViews,
  type ReaderViews,
} from './composeReaders.ts'
import { composeState, linkedRanks, linkRanks, takeSlot, unlinkHeld } from './gpuComposeLinks.ts'
import { settleSlot } from './gpuComposeSlot.ts'
import type { ComposeState } from './gpuComposeState.ts'
import { installComposedWorld } from './gpuComposeWorld.ts'

/** A row linked to a parent: its rows, its rank there, its mesh's local matrix. */
export type PlacementLink = { rows: PlacementRows; index: number; local: ArrayLike<number> }

/** A parent's world alone moves its slot: the frame hears it as any engine pose write. */
function settleAlone(
  rt: WebgpuPagesRuntime,
  state: ComposeState,
  slot: number,
  world: ArrayLike<number>,
) {
  if (settleSlot(rt, state, { slot, p: slot, world, relinked: false }))
    rt.run.gate.engineMovedInPlace()
}

/** A reader's new local moves the slot's version too: its views read that version alone. Whether
 *  the readers it holds changed. */
function holdSlotReaders(
  state: ComposeState,
  held: { slot: number; parent: object; readers: readonly PlacementLink[]; whole: boolean },
  viewsOf: () => ReaderViews,
) {
  const { slot, parent, readers, whole } = held
  if (!readers.length && !(whole && state.readers.has(slot))) return false
  return holdReaders(state.readers, slot, parent, readers, whole ? viewsOf() : undefined)
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
  const state = composeState(rt)
  const p = state.parentIds.get(parent)
  if (p === undefined && !links.length) return
  // A world alone — every slot, every frame (`geometry/partition/follow.ts`) —: no link read, nothing made.
  if (p !== undefined && !links.length && !whole) {
    settleAlone(rt, state, p, world)
    return
  }
  const { ranks, rooted, readers } = linkedRanks(rt, links)
  const slot = takeSlot(state, parent, p)
  let views: ReaderViews | undefined
  const viewsOf = () => (views ??= readerViews(rt.blendState.blendGpu))
  let relinked = whole && unlinkHeld(rt, state, slot, ranks)
  // A reader's new local moves the slot's version too: its views read that version alone.
  relinked = holdSlotReaders(state, { slot, parent, readers, whole }, viewsOf) || relinked
  if (!ranks.length && !readers.length && whole) {
    state.parentIds.delete(parent)
    state.freeSlots.push(slot)
    return
  }
  // A set linked again as it stands — a still parent's, every frame — relinks nothing.
  relinked = linkRanks(rt, state, { slot, ranks, links: rooted, whole }) || relinked
  const moved = settleSlot(rt, state, { slot, p, world, relinked })
  // Its readers' views read their rows composed: a move composes none until one is read, and a
  // set linked again as it stands keeps them.
  if (relinked && readers.length)
    readThroughViews(state.readers, slot, viewsOf(), state, rt.layout.selectionRoots)
  // Poses moved and no node entered or left: the frame hears it as any engine pose write. A still
  // world sent again — every slot a frame sends (`geometry/partition/follow.ts`) — moves nothing.
  if (moved || relinked) rt.run.gate.engineMovedInPlace()
}

/** The roots and the blended items of a growth read views on their new rows (`../growth/growth.ts`): the
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
