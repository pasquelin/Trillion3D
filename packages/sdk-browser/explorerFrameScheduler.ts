/** One coalesced frame, with asynchronous work waited outside the rendering callback. */
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
    rounds = 0;
  const schedule = () => {
    if (disposed || frame !== undefined) return;
    if (rounds >= 120) {
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
    void inputs.pending().then((again) => {
      waiting = false;
      if (again) schedule();
    }, fail);
  };
  function draw() {
    frame = undefined;
    if (disposed) return;
    try {
      rounds++;
      inputs.render();
      drain();
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
