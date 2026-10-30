/**
 * THE REFUSAL RECORD of every GPU grant (#1527): what a grant the budget or the device refused
 * waits for before it is asked again — never every frame, never never. A budget refusal waits for
 * the room it measured (`roomBytes`): the budget's room is known, the ask comes back once it holds
 * it. A device refusal has no room to wait for — no measure predicts the device's —: it is asked
 * again after `wait` milliseconds from `at`, the wait of the engine's one backoff (`backoff.ts`: it
 * doubles at each refusal in a row, spread so that grants refused together do not come back together).
 * The clock is `refusalNow`, time and not frames: a view at rest enters none. The shadow pool
 * (`../../lighting/shadows/vsm/frame/vsmGrant.ts`) and the frame targets (`../../frame/scale/scaleMemory.ts`)
 * keep one each.
 */
import { backoffMs } from './backoff.ts'

/** The clock a refusal's wait is read on, in milliseconds: monotonic, so a wall clock set back or forward never shortens or lengthens a wait. */
export const refusalNow = () => performance.now()

export type Refusal = {
  /** The ledger's room the grant waits for; `Infinity` for a device refusal. */
  readonly roomBytes: number
  /** The time, on `refusalNow`, it was refused at. */
  readonly at: number
  /** Milliseconds a device refusal waits from `at`; `Infinity` for a budget refusal. */
  readonly wait: number
  /** The device refusals in a row up to this one (the wait doubles with it); zero for a budget refusal. */
  readonly refusals: number
}

/** Refused by the budget at `at`: asked again once the ledger's room holds `roomBytes`. */
export const budgetRefusal = (roomBytes: number, at: number): Refusal => ({
  roomBytes,
  at,
  wait: Infinity,
  refusals: 0,
})

/** Refused by the device at `at`, after `last` — the same grant's last refusal, if any —: asked
 *  again after the backoff's next wait (`backoffMs`; `random`, a number in 0 .. 1, spreads it). */
export const deviceRefusal = (at: number, last?: Refusal, random?: number): Refusal => {
  const refusals = last && Number.isFinite(last.wait) ? last.refusals + 1 : 1
  return { roomBytes: Infinity, at, wait: backoffMs(refusals, random), refusals }
}

/** The time a refusal's wait ends at: `Infinity` for a budget refusal. */
export const retryAt = (refusal: Refusal) => refusal.at + refusal.wait

/** Whether `refusal` is the device's, still waiting at `now`: nothing asks the grant meanwhile. */
export const deviceWaiting = (refusal: Refusal, now: number) =>
  refusal.roomBytes === Infinity && now < retryAt(refusal)

/** Whether `refusal` may be asked again at `now`, the ledger's room at `roomBytes`: a device
 *  refusal holds no room to wait for, even a ledger with no ceiling, and waits its time. */
export const retryDue = (refusal: Refusal, roomBytes: number, now: number) =>
  (Number.isFinite(refusal.roomBytes) && roomBytes >= refusal.roomBytes) || now >= retryAt(refusal)
