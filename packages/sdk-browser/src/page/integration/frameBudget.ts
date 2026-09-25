/**
 * The main thread's budget, one definition for every stage that spends it (CONTRIBUTING.md
 * §Streaming rule 4): whether one more piece of work is admitted — the first always is, so a piece
 * longer than the ceiling still goes through, then while the clock since `open` is within it —,
 * and one counted.
 *
 * The arrival queue opens one per frame and drains within it (`./arrivalQueue.ts`), as do the
 * WebGPU row claims (`../../webgpu/row/claims.ts`) and texture tiles (`../../webgpu/tile/streamer.ts`);
 * the WebGPU residency queue opens one per turn of the event loop and yields past it
 * (`../../webgpu/residency/residentEnsurer.ts`).
 */
export type FrameBudget = { admits(): boolean; spend(): void };

/** `now` is the clock the budget is read on: `performance.now` unless a test drives it. */
export function createFrameBudget(ms: number, now = () => performance.now()) {
  let started = 0,
    spent = 0;
  return {
    /** Starts the clock: every piece until the next `open` shares it. Returns the time it read. */
    open() {
      spent = 0;
      return (started = now());
    },
    admits: () => spent === 0 || now() - started < ms,
    spend: () => void spent++,
  };
}

/**
 * Yields to the event loop — not only to the microtask queue.
 *
 * `await cache.load(...)` only waits for an already-resolved promise when the bytes are in memory:
 * the whole loop then runs in a single task, and neither the render, nor `requestAnimationFrame`,
 * nor page events get any chance to pass. A `MessageChannel` is a real task, without the four-
 * millisecond ceiling a nested `setTimeout` eventually suffers, and it runs in a hidden tab, where
 * no animation frame ever comes.
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
