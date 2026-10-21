import type { GpuCut } from '../../../gpu/core/selection.ts'
import { MAIN_VIEW, type CutStamp, type MaskSwap } from '../swap/swap.ts'
import type { FlagShape } from '../flagSections.ts'
import type { CutListCaps } from '../lists/cutListCaps.ts'

/** What a camera cut's dispatches, readbacks and views aside share (`runtime.ts`). */
export type DagRuntimeState = {
  last: GpuCut | null
  /** What the readback copied last was cut under; a new object at each copy, so a dropped dispatch
   *  gives back the one before by its pointer (`../dispatch.ts`). The cut submitted last is the main
   *  view's in the swap (`../swap/swap.ts`). */
  readback?: CutStamp
  pending: Promise<unknown>
  disposed: boolean
  dead: boolean
  worldRevision: number
  /** Advanced by every residency the cut is told (`voidCuts`): a cut made under an older one is
   *  not the cut made now. */
  residencyRevision: number
  /** Advanced only when a page a cut may name left, or the roots changed (`voidCuts`): a readback
   *  copied under an older one may name what the kernel can no longer draw, and is never adopted.
   *  Pages that only arrived leave a readback adoptable: everything it draws is still resident. */
  withdrawnRevision: number
  /** Serial of the main cut whose lists `out` holds and no readback copied yet; -1 none
   *  (`../dispatch.ts`, `copyOwed`). */
  owed: number
  /** Tables being made: no frame cuts until they are in place or refused. */
  growing: boolean
  /** The lists' caps the session asked since the flags were laid out, and the shape they lay them
   *  out in, taken once no readback is in flight (`../queueGrowth.ts`); none asked. */
  reshape?: { caps: CutListCaps; shape: FlagShape }
  /** The caps the device or the cut's share last refused the lists at: not asked again while the
   *  session asks them; none. */
  refusedCaps?: CutListCaps
  /** The slots of open counts the row cache's growth asked (`../queueGrowth.ts`, `followRows`); 0:
   *  none. */
  growHeld: number
  /** The device refused the saved regions the views aside ask (`../swap/swap.ts`): they cut without one. */
  regionsFull: boolean
}

/** A cut's state before its first dispatch. */
export const createDagRuntimeState = (): DagRuntimeState => ({
  last: null,
  readback: undefined,
  pending: Promise.resolve(),
  disposed: false,
  dead: false,
  worldRevision: 0,
  residencyRevision: 0,
  withdrawnRevision: 0,
  owed: -1,
  growing: false,
  reshape: undefined,
  refusedCaps: undefined,
  growHeld: 0,
  regionsFull: false,
})

/** The next dispatch cuts and reads back again: the main view's cut and readback in hand stand on
 *  no residency any more. The cut in hand stays. */
export function recutMain(swap: MaskSwap, state: DagRuntimeState) {
  recutView(swap, MAIN_VIEW)
  if (state.readback) state.readback.residency = -1
}

/** `view`'s next dispatch cuts again: its cut in hand stands on no residency any more. */
export function recutView(swap: MaskSwap, view: number) {
  const cut = swap.cuts[view - 1]
  if (cut) cut.residency = -1
}
