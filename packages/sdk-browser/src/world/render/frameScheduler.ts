import { DAG_READBACK_SLOTS } from '../../gpu/dag/layout.ts'
/** Frames the loop draws on its own, nothing arriving, before it pauses; an invalidate resets the
 *  count. */
const SETTLE_LIMIT = 120

/**
 * Frames whose feedback the loop awaits at once: the readback slots the cut alternates between
 * (`DAG_READBACK_SLOTS`), one number. Frame n+1 is encoded while the GPU still runs frame n, so a
 * frame costs max(CPU, GPU) rather than their sum. Two: the CPU of one frame hides behind the GPU of the one before, a third would
 * hide nothing more and only age the input and every feedback by one frame.
 */
const FRAMES_IN_FLIGHT = DAG_READBACK_SLOTS

/**
 * One coalesced frame, with asynchronous work waited outside the rendering callback.
 *
 * Drawing is paced by the display alone: while the loop has work, every animation-frame tick draws
 * exactly one frame, whatever the feedbacks are doing. A drawn frame asks its feedback (`pending`)
 * as it is submitted when a readback slot is free (`FRAMES_IN_FLIGHT`), so the feedback answers for
 * that frame's GPU work alone; a frame with no slot free draws and asks none, as an invalidate's
 * does. The feedbacks never gate the next draw: they are consumed one after the other in the order
 * they were asked, each once, whatever order they settle in, and only decide the stop — each says
 * whether the loop goes on, a stop cancelling the frame asked early, the newest having the last
 * word — and free their slot. A frame drawn with no feedback is covered by the next one asked.
 *
 * `progress` is a count that rises while what the image draws still arrives — the pages loaded —
 * and `arriving` tells a job is still loading. A frame consumed with nothing arrived since the one
 * before it spends one round of the settle limit; one after which something arrived, or while
 * `arriving`, restarts the count, so a view that streams for longer than the limit is drawn to its
 * last page instead of pausing on a coarse cut. The loop draws no frame of its own once the rounds
 * spent and the frames drawn since, not yet consumed, reach the limit: a still view nothing
 * reaches draws exactly the limit, then pauses.
 */
export function createExplorerFrameScheduler(inputs: {
  request: (callback: FrameRequestCallback) => number
  cancel: (id: number) => void
  render: () => void
  pending: () => Promise<boolean>
  error: (error: unknown) => void
  limited: () => void
  progress?: () => number
  arriving?: () => boolean
}) {
  let frame: number | undefined,
    disposed = false,
    /** Feedbacks asked and not consumed yet. */
    inFlight = 0,
    /** Where the feedbacks are consumed, in the order they were asked. */
    consumed: Promise<void> = Promise.resolve(),
    /** The frame to come is an invalidate's, drawn even at the settle limit's edge. */
    asked = false,
    idle = 0,
    /** Frames drawn since the last invalidate whose feedback is not consumed yet. */
    owed = 0,
    /** Of those, the frames drawn since the last feedback was asked: the next one covers them. */
    uncovered = 0,
    /** Counts the invalidates: a feedback of an earlier one spends no round of this one. */
    epoch = 0,
    /** `progress` when the last feedback was consumed. */
    seen = 0,
    revision = 0
  const schedule = () => {
    if (disposed || frame !== undefined) return
    if (idle + owed >= SETTLE_LIMIT && !inputs.arriving?.()) {
      // At the limit the last feedback in flight says whether the loop pauses (`limited`), once.
      if (!inFlight) inputs.limited()
      return
    }
    frame = inputs.request(draw)
  }
  const fail = (error: unknown) => {
    if (disposed) return
    dispose()
    inputs.error(error)
  }
  /** The feedback of the frame drawn at `submitted`, covering `weight` frames of invalidate
   *  `era`, consumed after `from` was seen: `again`, or frames drawn after it that asked none, ask
   *  a frame; a stop cancels the frame the loop asked early, the feedbacks after it asking one
   *  again if they say so. */
  const land = (again: boolean, submitted: number, from: number, weight: number, era: number) => {
    inFlight--
    if (disposed) return
    const count = inputs.progress?.() ?? seen
    if (era === epoch) {
      owed -= weight
      if (count === from && !inputs.arriving?.()) idle += weight
      else idle = 0
    }
    seen = count
    if (again || (!inFlight && submitted !== revision)) return schedule()
    if (frame === undefined || asked) return
    inputs.cancel(frame)
    frame = undefined
  }
  const ask = () => {
    inFlight++
    const submitted = revision,
      from = seen,
      weight = uncovered + 1,
      era = epoch,
      answer = inputs.pending()
    uncovered = 0
    // Handled now, consumed behind the feedbacks asked before it: a failure is said in turn too.
    answer.catch(() => {})
    consumed = consumed
      .then(() => answer)
      .then((again) => land(again, submitted, from, weight, era), fail)
  }
  function draw() {
    frame = undefined
    if (disposed) return
    try {
      asked = false
      revision++
      owed++
      inputs.render()
      if (inFlight < FRAMES_IN_FLIGHT) ask()
      else uncovered++
      schedule()
    } catch (error) {
      fail(error)
    }
  }
  function dispose() {
    disposed = true
    if (frame !== undefined) inputs.cancel(frame)
    frame = undefined
  }
  return {
    invalidate() {
      asked = true
      idle = owed = uncovered = 0
      epoch++
      schedule()
    },
    dispose,
  }
}
