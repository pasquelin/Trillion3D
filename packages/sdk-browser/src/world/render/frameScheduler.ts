import { DAG_READBACK_SLOTS } from '../../gpu/dag/layout.ts'
/** Frames the loop draws on its own, nothing arriving, before it pauses; an invalidate resets the
 *  count. */
const SETTLE_LIMIT = 120

/**
 * Frames whose feedback the loop awaits at once: the readback slots the cut alternates between
 * (`DAG_READBACK_SLOTS`), one number. Frame n+1 is encoded while the GPU still runs frame n, so a
 * frame costs max(CPU, GPU) rather than their sum, and a decision reads a feedback at most this
 * many frames old. Two: the CPU of one frame hides behind the GPU of the one before, a third would
 * hide nothing more and only age the input and every feedback by one frame.
 */
const FRAMES_IN_FLIGHT = DAG_READBACK_SLOTS

/**
 * One coalesced frame, with asynchronous work waited outside the rendering callback.
 *
 * Each drawn frame asks its feedback (`pending`) as it is submitted, so the feedback answers for
 * that frame's GPU work alone, and the next frame is asked right after `render`: the CPU draws
 * frame n+1 while the GPU runs frame n. The feedbacks are consumed one after the other in the order
 * they were asked, each once, whatever order they settle in: each says whether the loop goes on
 * or stops, a stop cancelling the frame asked early, and the newest has the last word. A frame the loop
 * asked for itself while `FRAMES_IN_FLIGHT` feedbacks are in flight is held: it draws nothing,
 * spends none of the settle limit and moves no revision, and the oldest landing asks again. A frame
 * an invalidate asked for draws at once; drawn with none to spare, it asks no feedback, the newest
 * landing asking a frame for it.
 *
 * `progress` is a count that rises while what the image draws still arrives — the pages loaded. A
 * feedback consumed with nothing arrived since the one before its frame spends one round of the
 * settle limit; one after which something arrived spends none, so a view that streams for longer
 * than the limit is drawn to its last page instead of pausing on a coarse cut. The loop draws no
 * frame of its own once the rounds spent and those its feedbacks in flight may spend reach the
 * limit: a still view nothing reaches draws exactly the limit, then pauses.
 */
export function createExplorerFrameScheduler(inputs: {
  request: (callback: FrameRequestCallback) => number
  cancel: (id: number) => void
  render: () => void
  pending: () => Promise<boolean>
  error: (error: unknown) => void
  limited: () => void
  progress?: () => number
}) {
  let frame: number | undefined,
    disposed = false,
    /** Feedbacks asked and not consumed yet. */
    inFlight = 0,
    /** Where the feedbacks are consumed, in the order they were asked. */
    consumed: Promise<void> = Promise.resolve(),
    /** The frame to come is an invalidate's, drawn even with every feedback in flight. */
    asked = false,
    idle = 0,
    /** `progress` when the last feedback was consumed. */
    seen = 0,
    revision = 0
  const schedule = () => {
    if (disposed || frame !== undefined) return
    if (idle + inFlight >= SETTLE_LIMIT) {
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
  /** The feedback of the frame drawn at `submitted`, `from` the count seen before it, consumed:
   *  `again`, or frames drawn after it that asked none, ask a frame; a stop cancels the frame the
   *  loop asked early, the feedbacks after it asking one again if they say so. */
  const land = (again: boolean, submitted: number, from: number) => {
    inFlight--
    if (disposed) return
    const count = inputs.progress?.() ?? seen
    if (count === from) idle++
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
      answer = inputs.pending()
    // Handled now, consumed behind the feedbacks asked before it: a failure is said in turn too.
    answer.catch(() => {})
    consumed = consumed.then(() => answer).then((again) => land(again, submitted, from), fail)
  }
  function draw() {
    frame = undefined
    if (disposed || (inFlight >= FRAMES_IN_FLIGHT && !asked)) return
    try {
      asked = false
      revision++
      inputs.render()
      if (inFlight < FRAMES_IN_FLIGHT) ask()
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
      idle = 0
      schedule()
    },
    dispose,
  }
}
