/** Frames the loop draws on its own before it pauses; an invalidate resets the count. */
const SETTLE_LIMIT = 120;

/**
 * One coalesced frame, with asynchronous work waited outside the rendering callback.
 *
 * The next frame is asked right after `render` (#983), so the browser keeps its frame cadence while
 * the frame's feedback (`pending`) is awaited; `pending` then only decides whether the loop goes on
 * or stops, and a stop cancels the frame asked early. A frame the loop asked for itself that comes
 * before that feedback is held: it draws nothing, spends none of the settle limit and moves no
 * revision, and the loop asks again once the feedback lands — so frame n's readbacks are always
 * consumed before frame n+1 makes its residency decisions, the loading sequence of before. A frame
 * an invalidate asked for draws at once, as before.
 */
export function createExplorerFrameScheduler(inputs: {
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
  render: () => void;
  pending: () => Promise<boolean>;
  error: (error: unknown) => void;
  limited: () => void;
}) {
  let frame: number | undefined,
    disposed = false,
    waiting = false,
    rounds = 0,
    revision = 0;
  /** Whether the frame to come is an invalidate's: an invalidate resets the rounds, and that frame
   *  draws the first round, even before the feedback it no longer waits for. */
  const asked = () => rounds === 0;
  const schedule = () => {
    if (disposed || frame !== undefined) return;
    if (rounds >= SETTLE_LIMIT) {
      inputs.limited();
      return;
    }
    frame = inputs.request(draw);
  };
  const fail = (error: unknown) => {
    if (disposed) return;
    dispose();
    inputs.error(error);
  };
  const drain = () => {
    if (waiting || disposed) return;
    waiting = true;
    const submitted = revision;
    void inputs.pending().then((again) => {
      waiting = false;
      if (again || submitted !== revision) schedule();
      else if (frame !== undefined && !asked()) {
        inputs.cancel(frame);
        frame = undefined;
      }
    }, fail);
  };
  function draw() {
    frame = undefined;
    if (disposed || (waiting && !asked())) return;
    try {
      rounds++;
      revision++;
      inputs.render();
      drain();
      // At the limit the feedback says whether the loop pauses (`limited`), as it did.
      if (rounds < SETTLE_LIMIT) schedule();
    } catch (error) {
      fail(error);
    }
  }
  function dispose() {
    disposed = true;
    if (frame !== undefined) inputs.cancel(frame);
    frame = undefined;
  }
  return {
    invalidate() {
      rounds = 0;
      schedule();
    },
    dispose,
  };
}
