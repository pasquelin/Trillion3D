/** A browser frame queue that runs nothing by itself: the test runs what was asked, oldest first,
 *  and a cancel takes its frame out, as `cancelAnimationFrame` does. */
export function frameQueue() {
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  return {
    request: (callback: FrameRequestCallback) => (frames.set(++next, callback), next),
    cancel: (id: number) => void frames.delete(id),
    get size() {
      return frames.size;
    },
    /** Runs the oldest frame asked; false when none is. */
    run() {
      const entry = frames.entries().next().value;
      if (!entry) return false;
      frames.delete(entry[0]);
      entry[1](0);
      return true;
    },
  };
}
