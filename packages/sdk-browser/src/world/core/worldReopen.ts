import { keepCanvasImage, releaseCanvasImage } from '../../gpu/core/canvasHandover.ts'
import type { WorldNotices } from '../diagnostic/worldNotices.ts'
import type { MeasuredWorldOptions } from '../session/options.ts'

/** Why a world's session opens again: a lost device, or an option the engine cannot take in place
 *  (a budget split, a scope). Content never does: every mesh, material, model and partition joins
 *  the session running, and what it cannot take is refused by name (`noticeRefused`). */
export type ReopenCause = 'device-lost' | 'option'

/** The measure of a reopen in flight: its causes, its start, the display frames it lasted. */
type Reopening = { causes: Set<ReopenCause>; start: number; frames: number; tick(): void }

/**
 * THE REOPENS OF A WORLD, KEPT AND JUSTIFIED. Its canvas keeps the image of a session that
 * closes until the next one draws (`canvasHandover.ts`); each reopen is said once that next image
 * is drawn, under `session-reopen`: its causes, its duration, and the display frames it showed no
 * new image through. A session's close ends what waited on it (`ended`): a wait carries on with
 * the next session rather than failing with the one that closed.
 */
export function worldReopens(
  canvas: HTMLCanvasElement,
  notices: Pick<WorldNotices, 'say'>,
  pass: () => void,
) {
  keepCanvasImage(canvas)
  const wanted = new Set<ReopenCause>(),
    ends = new WeakMap<object, { promise: Promise<void>; end: () => void }>()
  let reopening: Reopening | null = null
  const frame = globalThis.requestAnimationFrame?.bind(globalThis)
  const endOf = (session: object) => {
    let known = ends.get(session)
    if (!known) {
      let end = () => {}
      const promise = new Promise<void>((done) => (end = done))
      ends.set(session, (known = { promise, end }))
    }
    return known
  }
  /** The reopen in flight is over: said, drawn or not. */
  const settle = (drawn: boolean) => {
    const by = reopening
    if (!by) return
    reopening = null
    const causes = [...by.causes]
    notices.say('session-reopen', `The world's session opened again (${causes.join(', ')})`, {
      kind: 'lifecycle',
      cause: causes.join('+'),
      drawn,
      durationMs: performance.now() - by.start,
      framesWithoutImage: by.frames,
    })
  }
  /** Asks a pass for `cause`, which that pass carries. */
  const request = (cause: ReopenCause) => {
    wanted.add(cause)
    pass()
  }
  /** A session drew: the reopen that led to it is said. */
  const drew = () => settle(true)
  return {
    request,
    /** A session's options: its frames end the reopen. */
    options: (given: MeasuredWorldOptions): MeasuredWorldOptions => ({
      ...given,
      onFrame: (metrics) => (drew(), given.onFrame?.(metrics)),
    }),
    /** A pass begins, `previous` the session it closes, if any: that one is a reopen. */
    closing(previous: object | null) {
      const causes = [...wanted]
      wanted.clear()
      if (!previous) return
      endOf(previous).end()
      if (reopening) for (const cause of causes) reopening.causes.add(cause)
      else {
        // One display-frame counter per reopen, stopped once it is said.
        const by: Reopening = {
          causes: new Set(causes),
          start: performance.now(),
          frames: 0,
          tick() {
            if (reopening !== by) return
            by.frames++
            frame?.(by.tick)
          },
        }
        reopening = by
        frame?.(by.tick)
      }
    },
    drew,
    /** No session follows for now — nothing to draw, or one failed to open: the kept image goes. */
    none() {
      releaseCanvasImage(canvas)
      settle(false)
    },
    /** Settles once `session` has closed. */
    ended: (session: object) => endOf(session).promise,
    /** The world is gone: a reopen in flight is said undrawn, its canvas released, and every
     *  wait on its sessions ends. */
    dispose(last: object | null) {
      if (last) endOf(last).end()
      releaseCanvasImage(canvas, true)
      settle(false)
    },
  }
}
