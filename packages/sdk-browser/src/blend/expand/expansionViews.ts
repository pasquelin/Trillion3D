import { layerDraws } from '../translucencyPhase.ts'
import { wantsResponsive } from '../../frame/prepare/responsiveTarget.ts'
import { slotCapacity } from '../plan/planLayout.ts'
import { instanceBlocks } from './viewRoom.ts'
import { setBit } from '../../../../math/src/scalar/bits.ts'
import { planItem, planPipeline } from '../plan/plan.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { BlendGpuItem, WebgpuBlendState } from '../state.ts'

/**
 * THE VIEWS OF THE EXPANSION: the one sorted plan, expanded once for each set of items a draw keeps.
 *
 * The plan, its paint order and its slots are the pass's, whatever draws them. What a draw keeps of it
 * is the item's: its pass of the image (`translucencyPassBit`), when the image draws several sets of
 * passes (`layerDraws`), and, for the responsiveness pass, its responsiveness code (`ITEM_FILTER.responsive`).
 * The expansion kernel (`expandWgsl.ts`) runs once for each view over the same plan, an item the view
 * leaves out expanding no instance: its draw then reads its own arguments and its own run of the
 * instance list (`argsWord`, `instanceBase`), and the vertex stage processes nothing of the other
 * items. View 0 keeps every item: what the passes that draw them all (front, water, distortion, display
 * mask, holdout) read, and the lone draw of the layers.
 *
 * The sky surfaces (`ITEM_FILTER.sky`) belong to no layer: view 0 and the draws' views leave them out, and the sky pass draws them
 * from the view of their own (`SKY_VIEW`), ahead of the sky, the fog and the clouds; a face of the sky meshes' capture draws them from
 * its own (`FACE_SKY_VIEW`, opened in place of the main image's). The surfaces the view being prepared does not show (`cutSkyItems`) are
 * the frame's, not the item's: the cut is one bit set a rank in the frame data the verdict reads (`frameCutsAt`), so the filter words are
 * the scene's alone and no view, whatever its kind, rewrites them for another.
 *
 * The instance list holds view 0 first, then the views of the draws, then those of the responsiveness
 * passes, then the sky's: a view a draw keeps whole is view 0 itself, and the draws' views keep disjoint items, so
 * each block is at most the list of view 0.
 */

/** The filter word of an item (`draws[item].w`): its pass's bit (`translucencyPassBit`) and the flags a view may ask. */
const ITEM_FILTER = {
  passes: 0xe,
  responsive: 1 << 4,
  sky: 1 << 5,
} as const

/** The filter word of an item of pass code `passCode` (`translucencyPassCode`), responsive or not; a sky surface carries only its bit. */
export const itemFilterWord = (passCode: number, responsive: boolean, sky = false) =>
  sky ? ITEM_FILTER.sky : (1 << passCode) | (responsive ? ITEM_FILTER.responsive : 0)

/** What a view leaves out and asks of an item's filter word: no bit of `exclude`, every bit of `require`. */
export type ViewFilter = { exclude: number; require: number }
const filterAccepts = (word: number, { exclude, require }: ViewFilter) =>
  (word & exclude) === 0 && (word & require) === require

/** A view of the frame: its filter, where its instances start in the list, and whether the frame expands it. */
export type FrameView = ViewFilter & { instanceBase: number; active: boolean }

/** The draws of the image's layers (`layerDraws`). */
const LAYER_DRAWS = 3

/** The views: 0 keeps every item but the sky's, then for each draw of the layers (`LAYER_DRAWS`) the view of its
 *  passes and the view of the responsive items among them, then the sky pass's, then a face of the sky meshes' capture's (the two are
 *  never open in one expansion, and share a block of the instance list). */
export const SKY_VIEW = 1 + 2 * LAYER_DRAWS
export const FACE_SKY_VIEW = SKY_VIEW + 1
export const VIEW_COUNT = FACE_SKY_VIEW + 1
const colourView = (at: number) => 1 + 2 * at,
  responsiveView = (at: number) => 2 + 2 * at

/** The views a draw reads: its colour passes', and its responsiveness pass's; -1 where nothing is to draw. */
export type DrawViews = { colour: number; responsive: number }

/** The view the sky surfaces are drawn from in this image (`SKY_VIEW`, or `FACE_SKY_VIEW` for a face of the capture: `face`), -1 where the
 *  view keeps no sky surface of the plan. */
export const skyViewOf = (blendState: Pick<WebgpuBlendState, 'frameViews'>, face = false) => {
  const view = face ? FACE_SKY_VIEW : SKY_VIEW
  return blendState.frameViews[view].active ? view : -1
}

/** The views of the frame and the draws', as a new state holds them. */
export function viewState() {
  return {
    frameViews: Array.from({ length: VIEW_COUNT }, (): FrameView => ({
      exclude: 0,
      require: 0,
      instanceBase: 0,
      active: false,
    })),
    drawViews: Array.from({ length: LAYER_DRAWS }, (): DrawViews => ({ colour: 0, responsive: 0 })),
    /** The filter words an expansion capacity was summed over, and those sums by filter: cleared when the words move. */
    capacities: new Map<number, number>(),
    /** The plan or the filter words moved: what a draw knew of its slots before holds no more. */
    viewEpoch: 0,
    /** Per view, the epoch its main class was last looked at, and whether an entry of it passes the view. */
    mainSeen: new Int32Array(VIEW_COUNT).fill(-1),
    mainPasses: new Uint8Array(VIEW_COUNT),
  }
}

/** The instances the entries of `blendState`'s items that pass `filter` can expand at most (`drawsPacked`), summed once for a filter
 *  until the plan or the words move. */
function viewCapacity(blendState: WebgpuBlendState, filter: ViewFilter) {
  const key = (filter.exclude << 8) | filter.require
  let sum = blendState.capacities.get(key)
  if (sum !== undefined) return sum
  sum = 0
  const draws = blendState.drawsPacked,
    items = blendState.blendGpu
  for (let i = 0; i < items.length; i++)
    if (filterAccepts(draws[i * 4 + 3], filter)) sum += (items[i].sides ?? 1) * draws[i * 4 + 1]
  blendState.capacities.set(key, sum)
  return sum
}

/** Fills the frame's views from the image's draws and the items' passes, and each draw's: view 0 always; for a draw that keeps
 *  only some of the items, its view of its passes (view 0 itself where it keeps them all, none where it keeps none), and, where the
 *  temporal pass reads the responsiveness, its view of the responsive items among them. `skyOnly`: a sky meshes' face
 *  (`encodeSkyMeshFace.ts`) opens its sky view alone, the sky pass's view closed (they share a block); the main image plans them anew. */
export function planFrameViews(rt: WebgpuPagesRuntime, skyOnly = false) {
  const { blendState } = rt,
    { frameViews: views, drawViews } = blendState
  if (skyOnly) {
    // Every view closed but the face's, which takes the sky pass's block of the instance list.
    for (const view of views) view.active = false
    openSky(blendState, FACE_SKY_VIEW)
    return
  }
  for (const view of views) view.active = false
  const every = views[0]
  every.exclude = ITEM_FILTER.sky
  every.require = every.instanceBase = 0
  every.active = true
  const room = blendState.instanceCapacity,
    whole = viewCapacity(blendState, every),
    responsive = blendState.responsive && wantsResponsive(rt),
    hasSky = blendState.skyItems.length > 0
  let colourBase = room,
    responsiveBase = room * (instanceBlocks(blendState) - 1 - Number(hasSky))
  openSky(blendState, SKY_VIEW)
  for (const draw of layerDraws(rt)) {
    const used = drawViews[draw.at]
    used.colour = used.responsive = -1
    if (!draw.active) continue
    const exclude = ITEM_FILTER.sky | (draw.only ? ITEM_FILTER.passes & ~draw.only : 0)
    const kept = draw.only ? viewCapacity(blendState, { exclude, require: 0 }) : whole
    if (kept === whole) used.colour = 0
    else if (kept > 0) {
      used.colour = open(blendState, colourView(draw.at), exclude, 0, colourBase)
      colourBase += kept
    }
    if (!responsive) continue
    const asked = { exclude, require: ITEM_FILTER.responsive }
    const marked = viewCapacity(blendState, asked)
    if (marked === 0) continue
    used.responsive = open(
      blendState,
      responsiveView(draw.at),
      exclude,
      asked.require,
      responsiveBase,
    )
    responsiveBase += marked
  }
}

/** Opens `view` over the sky surfaces in the last block of the instance list, where the view being prepared shows some of them. */
function openSky(blendState: WebgpuBlendState, view: number) {
  if (blendState.skyItems.length > blendState.skyCut)
    open(
      blendState,
      view,
      0,
      ITEM_FILTER.sky,
      blendState.instanceCapacity * (instanceBlocks(blendState) - 1),
    )
}

/**
 * The sky surfaces the view being prepared shows (`drawn`, `../../frame/render/skyRoots.ts`): the others are cut, one bit a rank in the cut
 * words of the frame data (`frameCutsAt`) which the verdict reads, so that no view expands an instance of theirs and the sky pass, the
 * atmosphere's holes and the sky meshes' faces all take the one relevance. The words are the frame's: every view starts them anew, and
 * the items' filter words and the views' sums never move with a cut. Run before each view's expansion (`prepareBlend`), with no sky
 * surface too, which clears the words of a scene that had some.
 */
export function cutSkyItems(blendState: WebgpuBlendState, drawn: ReadonlySet<BlendGpuItem>) {
  const { skyItems, skyRanks, cutWords: cuts } = blendState
  cuts.fill(0)
  let cut = 0
  for (let k = 0; k < skyItems.length; k++) {
    if (drawn.has(skyItems[k])) continue
    setBit(cuts, skyRanks[k])
    cut++
  }
  blendState.skyCut = cut
}

/** Opens view `index` over the items that pass `exclude` and `require`, its instances at `instanceBase`; returns `index`. */
function open(
  blendState: Pick<WebgpuBlendState, 'frameViews' | 'mainSeen'>,
  index: number,
  exclude: number,
  require: number,
  instanceBase: number,
) {
  const view = blendState.frameViews[index]
  // A view that now keeps other items looks at the main class again (`slotMayDraw`).
  if (view.exclude !== exclude || view.require !== require) blendState.mainSeen[index] = -1
  view.exclude = exclude
  view.require = require
  view.instanceBase = instanceBase
  view.active = true
  return index
}

/** The arguments of a view, where its slots' indirect draws start: whole slots of the plan, one block a view. */
export const viewArgsWord = (entries: number, view: number) => view * slotCapacity(entries) * 4

/** Whether view `view` can hold an instance in draw slot `slot` of the plan, known without the GPU: an own slot draws one item, whose filter
 *  word the view accepts or not; a gap draws the main class, which the view keeps if some entry of it does. View 0 keeps all but the sky's. A slot this answers no for is not encoded: no pipeline set, no draw of no instance. */
export function slotMayDraw(blendState: WebgpuBlendState, view: number, slot: number) {
  const own = blendState.slotOwns[slot],
    words = blendState.drawsPacked,
    filter = blendState.frameViews[view]
  if (own >= 0)
    return filterAccepts(
      words[planItem(blendState.seeds[blendState.ownSeeds[own]]) * 4 + 3],
      filter,
    )
  if (blendState.mainSeen[view] !== blendState.viewEpoch) {
    blendState.mainSeen[view] = blendState.viewEpoch
    blendState.mainPasses[view] = 0
    for (const entry of blendState.seeds)
      if (
        planPipeline(entry) === blendState.mainPipeline &&
        filterAccepts(words[planItem(entry) * 4 + 3], filter)
      ) {
        blendState.mainPasses[view] = 1
        break
      }
  }
  return blendState.mainPasses[view] === 1
}
