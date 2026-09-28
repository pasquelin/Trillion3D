/**
 * The main thread's budget, one definition for every stage that spends it (CONTRIBUTING.md
 * §Streaming rule 4): whether one more piece of work is admitted — the first always is, so a piece
 * longer than the ceiling still goes through, then while the clock since `open`, stopped between
 * two stages (`pause`, `resume`), is within it —, and one counted.
 *
 * A session holds one integration budget per frame (`BackendContext.frameBudget`): its frame opens
 * it, the cells and the arrival drain spend from it (`./arrivalQueue.ts`), and it pauses while the
 * engine does its other work, then the WebGPU row records spend what is left
 * (`../../webgpu/row/claims.ts`). Texture tiles keep their own upload ceiling
 * (`../../webgpu/tile/streamer.ts`); the WebGPU residency queue opens one per turn of the event
 * loop and yields past it, a bounded number per frame (`createSharePace`,
 * `../../webgpu/residency/residentEnsurer.ts`).
 */
export type FrameBudget = { admits(): boolean; spend(): void };
/** A budget with its clock: the frame that owns it opens it. */
export type FrameClock = ReturnType<typeof createFrameBudget>;

/** `now` is the clock the budget is read on: `performance.now` unless a test drives it. */
export function createFrameBudget(ms: number, now = () => performance.now()) {
  let started = 0,
    used = 0,
    spent = 0;
  return {
    /** Starts the clock: every piece until the next `open` shares it. Returns the time it read. */
    open() {
      spent = used = 0;
      return (started = now());
    },
    /** Stops the clock: what runs until `resume` is not integration and spends none of it. */
    pause: () => void (used += now() - started),
    resume: () => void (started = now()),
    admits: () => spent === 0 || used + now() - started < ms,
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

/** The longest a share waits for a frame: a visible page whose frames stop (an iframe scrolled
 *  out of view) still loads, a share pair per wait. */
const FRAME_WAIT_MS = 100;

/** The page's frames: whether they come, and the next one. A hidden page has none. */
const pageFrames = {
  visible: () =>
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible' &&
    typeof requestAnimationFrame === 'function',
  /** The next frame, or the page hidden meanwhile, where none would come, or `FRAME_WAIT_MS`. */
  next: () =>
    new Promise<void>((done) => {
      const hidden = () => {
        if (document.visibilityState === 'hidden') finish();
      };
      const finish = () => {
        cancelAnimationFrame(id);
        clearTimeout(late);
        document.removeEventListener('visibilitychange', hidden);
        done();
      };
      const id = requestAnimationFrame(finish),
        late = setTimeout(finish, FRAME_WAIT_MS);
      document.addEventListener('visibilitychange', hidden);
    }),
};

/**
 * Opens a budget's next share (#983): after a task yield, as long as fewer than `shares` opened
 * since the last frame of a visible page; past them, at its next frame, so the shares cumulated
 * between two frames stay bounded. A hidden page never waits for a frame: one share per task, as
 * before, and it loads no slower.
 */
export function createSharePace(open: () => void, shares: number, frames = pageFrames) {
  let opened = 0,
    tick: Promise<void> | undefined;
  const arm = () =>
    (tick ??= frames.next().then(() => {
      tick = undefined;
      opened = 0;
    }));
  return async () => {
    await (frames.visible() && opened >= shares ? arm() : yieldToEventLoop());
    if (frames.visible()) {
      void arm();
      opened++;
    }
    open();
  };
}
