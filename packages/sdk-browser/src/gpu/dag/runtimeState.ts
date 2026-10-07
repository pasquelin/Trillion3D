import type { GpuCut } from '../core/selection.ts'
import { DAG_READBACK_SLOTS } from './layout.ts'
import { MAIN_VIEW, type CutStamp, type MaskSwap } from './swap.ts'

/** What a camera cut's dispatches, readbacks and views aside share (`runtime.ts`). */
export type DagRuntimeState = {
  last: GpuCut | null
  /** What the readback copied last was cut under; a new object at each copy, so a dropped dispatch
   *  gives back the one before by its pointer (`dispatch.ts`). The cut submitted last is the main
   *  view's in the swap (`swap.ts`). */
  readback?: CutStamp
  pending: Promise<unknown>
  disposed: boolean
  dead: boolean
  worldRevision: number
  residencyRevision: number
  mapped: boolean[]
  slot: number
  /** Serial of the main cut whose lists `out` holds and no slot copied yet; -1 none
   *  (`dispatch.ts`, `copyOwed`). */
  owed: number
  /** The list cap a truncated readout asked for, taken once no readback is in flight; 0: none. */
  grow: number
  /** A list being made: no frame cuts until it is in place or refused. */
  growing: boolean
  /** The device refused a larger list: a truncated readout now goes to the host as it is. */
  listFull: boolean
  /** The device refused the saved regions the views aside ask (`swap.ts`): they cut without one. */
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
  mapped: new Array<boolean>(DAG_READBACK_SLOTS).fill(false),
  slot: 0,
  owed: -1,
  grow: 0,
  growing: false,
  listFull: false,
  regionsFull: false,
})

/** The next dispatch cuts and reads back again: the main view's cut and readback in hand stand on
 *  no residency any more. The cut in hand stays. */
export function recutMain(swap: MaskSwap, state: DagRuntimeState) {
  const cut = swap.cuts[MAIN_VIEW - 1]
  if (cut) cut.residency = -1
  if (state.readback) state.readback.residency = -1
}
