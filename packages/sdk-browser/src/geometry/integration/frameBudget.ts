import { cpuNow } from '../../diagnostic/stopwatch.ts'

/**
 * The main thread's budget, one definition for every stage that spends it (CONTRIBUTING.md
 * §Streaming rule 4): whether one more piece of work is admitted — a stage's first always is, so a
 * piece longer than the ceiling still goes through and no stage starves, then while the clock since
 * `open`, stopped between two stages (`pause`, `resume`), is within it —, and one counted.
 *
 * A session holds ONE CLOCK PER FRAME (`EngineContext.frameBudget`, `MAIN_THREAD_FRAME_MS`), its
 * stages spending it in priority order: its frame opens it, the cells and the arrival drain spend
 * from it first (`./arrivalQueue.ts`), it pauses while the engine does its other work, the texture
 * tiles spend what is left (`../../materials/virtual/streamer/streamer.ts`). No stage opens a clock
 * of its own: their sum is the frame's main-thread share. The geometry pool's pages spend none of
 * it: a frame installs a count of them (`../residency/queue.ts`), whatever they cost.
 *
 * Until the session's first image is shown, the share is the whole main-thread frame (`widen`,
 * `../../frame/loop/firstImage.ts`): nothing is on screen to keep smooth, every stage loads the
 * view; its own share again once that image is shown (`narrow`).
 */
export type FrameBudget = { admits(): boolean; spend(): void }
/** A budget with its clock: the frame that owns it opens it. */
export type FrameClock = ReturnType<typeof createFrameBudget>

/** How a budget reads its clock: `now` the engine's CPU clock unless a test drives it. */
export type FrameBudgetOptions = { now?: () => number }

export function createFrameBudget(ms: number, { now = cpuNow }: FrameBudgetOptions = {}) {
  let started = 0,
    used = 0,
    spent = 0,
    running = false,
    /** The frame's share now: `ms`, or wider while widened (`widen`). */
    share = ms,
    /** Where the current stage began on the clock, and the ceiling of its own it may not pass. */
    stageAt = 0,
    ceiling = Infinity
  /** What the clock counted since `open`, read once. */
  const elapsed = () => used + (running ? now() - started : 0)
  const resume = () => {
    if (running) return
    started = now()
    running = true
  }
  return {
    /** Starts the clock: every piece until the next `open` shares it. Returns the time it read. */
    open() {
      spent = used = stageAt = 0
      ceiling = Infinity
      running = true
      return (started = now())
    },
    /** Stops the clock: what runs until `resume` is not integration and spends none of it. A clock
     *  already stopped stays as it is. */
    pause: () => {
      if (!running) return
      used += now() - started
      running = false
    },
    /** Runs the clock again; a running clock keeps the time it counts. */
    resume,
    /** A later stage of the frame on the same clock: it runs again and the stage's first piece is
     *  admitted, whatever the stages before it spent. `ceilingMs` is the stage's own cap within the
     *  frame's share (the host's texture-upload ceiling): it stops at whichever comes first. */
    stage(ceilingMs = Infinity) {
      spent = 0
      resume()
      stageAt = elapsed()
      ceiling = ceilingMs
    },
    /** Ms the current stage has counted so far. */
    stageMs: () => elapsed() - stageAt,
    admits() {
      if (spent === 0) return true
      const at = elapsed()
      return at < share && at - stageAt < ceiling
    },
    spend: () => void spent++,
    /** Every stage spends a share of `wideMs` from now on, never less than its own, until
     *  `narrow`: the frame's whole main-thread time while no image is shown yet. */
    widen: (wideMs: number) => void (share = Math.max(ms, wideMs)),
    /** Back to the share it was made with (`widen`). */
    narrow: () => void (share = ms),
  }
}

/**
 * Yields to the event loop — not only to the microtask queue: a `MessageChannel` is a real task,
 * without the four-millisecond ceiling a nested `setTimeout` eventually suffers, and it runs in a
 * hidden tab, where no animation frame ever comes.
 */
const yieldToEventLoop = () =>
  new Promise<void>((done) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      done()
    }
    channel.port2.postMessage(0)
  })

/** The longest a wait for a frame lasts on a visible page: past it, a page whose frames stopped
 *  (an iframe scrolled out of view, a host drawing no more) goes on as a hidden one does. */
const FRAME_WAIT_MS = 100

/** Whether the page's frames come: a hidden page has none. */
const pageVisible = () =>
  typeof document !== 'undefined' &&
  document.visibilityState === 'visible' &&
  typeof requestAnimationFrame === 'function'

/**
 * THE FRAMES A STAGE PACES ITSELF ON, the engine's: `frame` is told once a frame, `count` counts
 * them, `next` resolves at the next one. When none comes — a hidden page, at once a task later; a
 * visible one whose frames stopped, `FRAME_WAIT_MS` later — the wait counts as a frame and ends, so
 * a stage paced on frames never waits for good: a barrier that draws none still settles
 * (`../residency/queue.ts`).
 */
export function createFrameGate() {
  let count = 0
  const waiting: (() => void)[] = []
  const frame = () => {
    count++
    for (const end of waiting.splice(0)) end()
  }
  return {
    /** Frames so far. */
    get count() {
      return count
    },
    frame,
    /** The next frame, or the end of a wait for one that does not come. */
    next() {
      return new Promise<void>((done) => {
        const at = count
        let timer: ReturnType<typeof setTimeout> | undefined
        waiting.push(() => {
          clearTimeout(timer)
          done()
        })
        const late = () => {
          if (count === at) frame()
        }
        if (pageVisible()) timer = setTimeout(late, FRAME_WAIT_MS)
        else void yieldToEventLoop().then(late)
      })
    },
  }
}
