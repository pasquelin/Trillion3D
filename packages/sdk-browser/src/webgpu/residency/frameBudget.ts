import { STREAMING_FRAME_MS } from '../../backend/common.ts';

/**
 * Yields to the event loop — not only to the microtask queue.
 *
 * `await cache.load(...)` only waits for an already-resolved promise when the bytes are in memory:
 * the whole loop then runs in a single task, and neither the render, nor `requestAnimationFrame`,
 * nor page events get any chance to pass. A `MessageChannel` is a real task, without the four-
 * millisecond ceiling a nested `setTimeout` eventually suffers.
 */
export const yieldToEventLoop = () =>
  new Promise<void>((done) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      done();
    };
    channel.port2.postMessage(0);
  });

/** The next display frame, or the next task where nothing is displayed. */
export const nextDisplayFrame = () =>
  typeof requestAnimationFrame === 'function'
    ? new Promise<void>((done) => requestAnimationFrame(() => done()))
    : yieldToEventLoop();

export type FrameBudget = ReturnType<typeof createFrameBudget>;

/**
 * The residency queue's main-thread share of each display frame (`STREAMING_FRAME_MS`, published).
 *
 * Admissions spend it one after the other; before each one, `pace` asks whether the frame can still
 * hold one like the last. When it cannot, the queue waits for the NEXT FRAME — not for the next task,
 * which would let it spend again in the same frame — and the share starts over. Nothing is a fixed
 * slice: a frame with room admits as much as its share holds, in one go. The first admission of a
 * frame always runs, so a single one larger than the share still makes progress, alone in its frame.
 *
 * Time is what the admission took on the main thread's clock, its awaits included: an overestimate,
 * so the share is never exceeded by what the clock does not see.
 */
export function createFrameBudget(
  options: { budgetMs?: number; nextFrame?: () => Promise<void>; now?: () => number } = {},
) {
  const budget = options.budgetMs ?? STREAMING_FRAME_MS,
    nextFrame = options.nextFrame ?? nextDisplayFrame,
    now = options.now ?? (() => performance.now());
  let spent = 0,
    last = 0,
    frame: Promise<void> | null = null;
  /** The frame the share is spent in: it ends at the next display frame, which gives it back. */
  const current = () =>
    (frame ??= nextFrame().then(() => {
      frame = null;
      spent = 0;
    }));
  return {
    /** Before an admission: resolves at once while the frame holds one more, else at the next frame.
     *  True when it waited, so the caller rereads what may have moved meanwhile. */
    async pace() {
      const open = current();
      if (spent === 0 || spent + last <= budget) return false;
      await open;
      return true;
    },
    /** Runs one admission on the share. */
    async spend<T>(work: () => Promise<T>) {
      const start = now();
      try {
        return await work();
      } finally {
        last = now() - start;
        spent += last;
      }
    },
  };
}
