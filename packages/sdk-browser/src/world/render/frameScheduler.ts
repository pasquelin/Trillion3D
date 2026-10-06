/** Frames the loop draws on its own, nothing arriving, before it pauses; an invalidate resets the
 *  count. */
const SETTLE_LIMIT = 120

/**
 * One coalesced frame, with asynchronous work waited outside the rendering callback.
 *
 * The next frame is asked right after `render`, so the browser keeps its frame cadence while
 * the frame's feedback (`pending`) is awaited; `pending` then only decides whether the loop goes on
 * or stops, and a stop cancels the frame asked early. A frame the loop asked for itself that comes
 * before that feedback is held: it draws nothing, spends none of the settle limit and moves no
 * revision, and the loop asks again once the feedback lands — so frame n's readbacks are always
 * consumed before frame n+1 makes its residency decisions. A frame an invalidate asked for draws
 * at once.
 *
 * `progress` is a count that rises while what the image draws still arrives — the pages loaded: a
 * frame after which it moved spends none of the settle limit, so a view that streams for longer
 * than the limit is drawn to its last page instead of pausing on a coarse cut.
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
    waiting = false,
    /** The frame to come is an invalidate's, drawn even before the feedback it no longer waits for. */
    asked = false,
    idle = 0,
    arrived = 0,
    revision = 0
  const schedule = () => {
    if (disposed || frame !== undefined) return
    if (idle >= SETTLE_LIMIT) {
      inputs.limited()
      return
    }
    frame = inputs.request(draw)
  }
  const fail = (error: unknown) => {
    if (disposed) return
    dispose()
    inputs.error(error)
  }
  const drain = () => {
    if (waiting || disposed) return
    waiting = true
    const submitted = revision
    void inputs.pending().then((again) => {
      waiting = false
      if (again || submitted !== revision) schedule()
      else if (frame !== undefined && !asked) {
        inputs.cancel(frame)
        frame = undefined
      }
    }, fail)
  }
  function draw() {
    frame = undefined
    if (disposed || (waiting && !asked)) return
    try {
      asked = false
      revision++
      inputs.render()
      const count = inputs.progress?.() ?? arrived
      if (count === arrived) idle++
      arrived = count
      drain()
      // At the limit the feedback says whether the loop pauses (`limited`), as it did.
      if (idle < SETTLE_LIMIT) schedule()
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
