import { DAG_READBACK_SLOTS } from '../../geometry/dag/layout.ts'

/**
 * Frames whose feedback the loop awaits at once: the readback slots the cut alternates between
 * (`DAG_READBACK_SLOTS`), one number. Frame n+1 is encoded while the GPU still runs frame n, so a
 * frame costs max(CPU, GPU) rather than their sum. Two: the CPU of one frame hides behind the GPU of the one before, a third would
 * hide nothing more and only age the input and every feedback by one frame.
 */
const FRAMES_IN_FLIGHT = DAG_READBACK_SLOTS

/**
 * The interactive loop: a frame on every display tick, as long as the page runs it — a hidden
 * page's ticks stop by themselves —, never paused because the image settled, so temporal
 * accumulation and streaming keep refining a still view.
 *
 * A drawn frame asks its feedback (`pending`) as it is submitted when a readback slot is free
 * (`FRAMES_IN_FLIGHT`), so the feedback answers for that frame's GPU work alone; a frame with no
 * slot free draws and asks none. The feedbacks never gate the next draw: they are consumed one after
 * the other in the order they were asked, each once, whatever order they settle in; a failed one
 * stops the loop (`error`).
 *
 * One rule paces the ticks themselves: a tick `skip` leaves out — the device still running the
 * images it may hold in flight, or the host's frame cap (`../cadence.ts`) — is no frame: nothing is drawn or asked, and the next tick is asked in
 * its place. Without `skip`, every tick draws.
 */
export function createExplorerFrameScheduler(inputs: {
  request: (callback: FrameRequestCallback) => number
  cancel: (id: number) => void
  render: () => void
  pending: () => Promise<unknown>
  error: (error: unknown) => void
  skip?: () => boolean
}) {
  let frame: number | undefined,
    disposed = false,
    /** Feedbacks asked and not consumed yet. */
    inFlight = 0,
    /** Where the feedbacks are consumed, in the order they were asked. */
    consumed: Promise<void> = Promise.resolve()
  const schedule = () => {
    if (disposed || frame !== undefined) return
    frame = inputs.request(draw)
  }
  const fail = (error: unknown) => {
    if (disposed) return
    dispose()
    inputs.error(error)
  }
  const ask = () => {
    inFlight++
    const answer = inputs.pending()
    // Handled now, consumed behind the feedbacks asked before it: a failure is said in turn too.
    answer.catch(() => {})
    consumed = consumed.then(() => answer).then(() => void inFlight--, fail)
  }
  function draw() {
    frame = undefined
    if (disposed) return
    try {
      // A tick left out draws nothing; the next one is asked all the same.
      if (!inputs.skip?.()) {
        inputs.render()
        if (inFlight < FRAMES_IN_FLIGHT) ask()
      }
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
    /** Asks a frame now, where none is asked yet: the loop's first, or one after the host changed
     *  something between ticks. */
    invalidate: schedule,
    dispose,
  }
}
