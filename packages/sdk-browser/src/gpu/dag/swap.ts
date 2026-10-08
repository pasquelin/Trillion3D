import type { SelectionUniforms } from '../core/selection.ts'
import { sameSelectionUniforms } from '../core/selectionCopy.ts'
import { REGION_NONE } from './shader/swapWgsl.ts'

/** The main view's token; a view drawn aside takes its own (`takeAsideView`). A view's token less
 *  one is its region of `out` (`shader/swapWgsl.ts`). */
export const MAIN_VIEW = 1

/** What a cut or a readback was made under: its uniforms, the residency and the poses. */
export type CutStamp = {
  uniforms: SelectionUniforms
  residency: number
  world: number
}

/** A view's last cut on the shared tables: its inputs, its serial, and whether its readback came
 *  back whole — its journal is then its whole mask, and comes back without a cut. */
type ViewCut = CutStamp & {
  serial: number
  whole: boolean
}

/**
 * WHOSE CUT THE SHARED TABLES HOLD (`shader/swapWgsl.ts`). The draw mask and the drawn journal are
 * the cut of `owner`, `cut` its serial; `out`'s lists are `outOwner`'s, which a copy reads. `out`
 * holds `regions` saved journals — none until a view is drawn aside, then one a view alive —, each
 * the journal of the cut `saved` names. Serials count every cut the tables ran, so a saved journal
 * is believed for the one cut it came from. `cuts` is each view's last cut, `alive` the views
 * aside in use, by region.
 */
export type MaskSwap = {
  owner: number
  cut: number
  outOwner: number
  serial: number
  regions: number
  saved: number[]
  cuts: (ViewCut | undefined)[]
  alive: boolean[]
}

export const createMaskSwap = (): MaskSwap => ({
  owner: 0,
  cut: -1,
  outOwner: 0,
  serial: 0,
  regions: 0,
  saved: [],
  cuts: [],
  alive: [true],
})

/** A token for a view drawn aside: the lowest region no view alive holds. */
export function takeAsideView(swap: MaskSwap) {
  let region = 1
  while (swap.alive[region]) region++
  swap.alive[region] = true
  return region + 1
}

/** `view` is released: its region is free for the next view aside, its journal believed no more. */
export function releaseAsideView(swap: MaskSwap, view: number) {
  const region = view - 1
  swap.alive[region] = false
  swap.cuts[region] = undefined
  swap.saved[region] = -1
  if (swap.owner === view) swap.owner = 0
}

/** The regions the views alive ask of `out`: the main view's and one a view aside, none alone. */
export function regionsWanted(swap: MaskSwap) {
  const top = swap.alive.lastIndexOf(true)
  return top > 0 ? top + 1 : 0
}

/** `out` was made again with `regions` regions: no journal is saved there yet, and the lists the
 *  old one held are gone. */
export function newRegions(swap: MaskSwap, regions: number) {
  swap.regions = regions
  swap.saved = new Array<number>(regions).fill(-1)
  swap.outOwner = 0
}

/** True when `stamp` was made under `uniforms`, the residency and the poses in place. */
export const stampMatches = (
  stamp: CutStamp | undefined,
  uniforms: SelectionUniforms,
  state: { residencyRevision: number; worldRevision: number },
) =>
  !!stamp &&
  stamp.residency === state.residencyRevision &&
  stamp.world === state.worldRevision &&
  sameSelectionUniforms(stamp.uniforms, uniforms)

/** True when `view`'s last cut was made under `uniforms`, the residency and the poses in place:
 *  cut again, it would be the same cut. */
export const sameCut = (
  swap: MaskSwap,
  view: number,
  uniforms: SelectionUniforms,
  state: { residencyRevision: number; worldRevision: number },
) => stampMatches(swap.cuts[view - 1], uniforms, state)

/** True when the mask in place is `view`'s last cut's. */
export const inPlace = (swap: MaskSwap, view: number) =>
  swap.owner === view && swap.cuts[view - 1]?.serial === swap.cut

/** True when `view`'s region holds the journal of its last cut. */
export const restorable = (swap: MaskSwap, view: number) =>
  view - 1 < swap.regions && swap.saved[view - 1] === swap.cuts[view - 1]?.serial

/** `view` cuts the tables under `cut`'s inputs: its cut is the next serial, and holds the mask,
 *  the journal and `out`. */
export function noteCut(swap: MaskSwap, view: number, cut: CutStamp) {
  swap.owner = swap.outOwner = view
  swap.cut = ++swap.serial
  swap.cuts[view - 1] = { ...cut, serial: swap.cut, whole: false }
  return swap.cut
}

/** The readback of `view`'s cut `serial` came back whole: its journal is its whole mask. */
export function noteWhole(swap: MaskSwap, view: number, serial: number) {
  const last = swap.cuts[view - 1]
  if (last?.serial === serial) last.whole = true
}

/** The region the journal in place is saved to before `view` takes the mask, `REGION_NONE` when
 *  none: its owner has no region, or its region already holds this very cut (A, B, A, B). */
export function saveRegionFor(swap: MaskSwap, view: number) {
  const region = swap.owner - 1
  if (!swap.owner || swap.owner === view || region >= swap.regions) return REGION_NONE
  if (swap.saved[region] === swap.cut) return REGION_NONE
  swap.saved[region] = swap.cut
  return region
}

/**
 * What one dispatch for `view` may change of the swap — whose cut the tables hold, the serials, the
 * region its owner's journal is saved to (`saveRegionFor`), `view`'s last cut (`noteCut`) — held as
 * the few values it is and given back by the returned function when the command buffer is
 * dropped: a cut that never ran is not remembered as run. Nothing else moves within a dispatch, so
 * nothing else is copied (the main view's `dispatch.ts`, a view's aside `aside.ts`, a swap
 * `swapEncode.ts`).
 */
export function holdSwap(swap: MaskSwap, view: number) {
  const { owner, cut, outOwner, serial, saved } = swap,
    region = owner - 1,
    savedCut = saved[region],
    viewCut = swap.cuts[view - 1]
  return () => {
    swap.owner = owner
    swap.cut = cut
    swap.outOwner = outOwner
    swap.serial = serial
    // `out` made again since (`newRegions`) holds no journal of before: nothing to give back.
    if (region >= 0 && region < saved.length && swap.saved === saved) saved[region] = savedCut
    swap.cuts[view - 1] = viewCut
    // A view's first cut grew the list by its slot: the slot goes with it.
    if (viewCut === undefined && swap.cuts.length === view) swap.cuts.length = view - 1
  }
}
