/**
 * THE REFUSAL RECORD of every GPU grant (#1527): what a grant the budget or the device refused
 * waits for before it is asked again — never every frame, never never. A budget refusal waits for
 * the room it measured (`roomBytes`): the budget's room is known, the ask comes back once it holds
 * it. A device refusal has no room to wait for — no measure predicts the device's —: it is asked
 * again after `wait` frames from `frame`, twice as long after each refusal in a row, up to
 * `RETRY_MAX` times the first. The shadow pool (`../../webgpu/pages/render/vsm/vsmGrant.ts`) and the
 * frame targets (`../../frame/scaleMemory.ts`) keep one each.
 */
export type Refusal = {
  /** The ledger's room the grant waits for; `Infinity` for a device refusal. */
  readonly roomBytes: number
  /** The frame it was refused at. */
  readonly frame: number
  /** Frames a device refusal waits from `frame`; `Infinity` for a budget refusal. */
  readonly wait: number
}

/** Frames a device refusal first waits, and the most times that it doubles to. */
const RETRY_FRAMES = 300,
  RETRY_MAX = 64

/** Refused by the budget at `frame`: asked again once the ledger's room holds `roomBytes`. */
export const budgetRefusal = (roomBytes: number, frame: number): Refusal => ({
  roomBytes,
  frame,
  wait: Infinity,
})

/** Refused by the device at `frame`, after `last` — the same grant's last refusal, if any —: asked
 *  again after a wait twice the last device refusal's. */
export const deviceRefusal = (frame: number, last?: Refusal): Refusal => ({
  roomBytes: Infinity,
  frame,
  wait:
    last && Number.isFinite(last.wait)
      ? Math.min(last.wait * 2, RETRY_FRAMES * RETRY_MAX)
      : RETRY_FRAMES,
})

/** The frame a refusal's wait ends at: `Infinity` for a budget refusal. */
export const retryFrame = (refusal: Refusal) => refusal.frame + refusal.wait

/** Whether `refusal` may be asked again at `frame`, the ledger's room at `roomBytes`. */
export const retryDue = (refusal: Refusal, roomBytes: number, frame: number) =>
  roomBytes >= refusal.roomBytes || frame >= retryFrame(refusal)
