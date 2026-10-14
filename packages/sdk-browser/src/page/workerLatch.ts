/**
 * A WORKER THAT MAY FAIL, AND THE MAIN THREAD BEHIND IT: the one lifecycle of the page tasks' pool
 * (`work/host.ts`) and of the integration lane (`integration/host.ts`), over the engine's worker
 * host (`../host/workerPool.ts`). Made at its first use; it serves once its start probe said yes —
 * at once without a probe —, and is latched broken when the probe says no or the worker dies after:
 * its tasks then run on the main thread for the rest of the session, as relaunching a lost worker
 * on every task would turn a failure into a loop. Nothing waits on the probe: until it answers, the
 * caller runs its task on the main thread, so no task ever depends on a worker starting.
 */
export function createWorkerLatch<T extends { readonly alive: boolean; retire(): void }>(
  make: () => T | undefined,
  probe?: (worker: T) => Promise<boolean>,
) {
  let held: T | undefined,
    /** `undefined` until the probe answered, then its verdict; false once broken. */
    started: boolean | undefined
  /** The probe's verdict on `made`, unless it was released since. */
  const answered = (made: T, ok: boolean) => {
    if (held !== made) return
    started = ok
    if (!ok) held = undefined
  }
  return {
    /** The worker if it serves now, `undefined` otherwise. */
    open() {
      if (started === false) return undefined
      if (!held) {
        const made = make()
        if (!made) return undefined
        held = made
        if (probe) void probe(made).then((ok) => answered(made, ok))
        else started = true
      }
      if (started && !held.alive) started = false
      return started ? held : undefined
    },
    /** The worker made so far, alive or not. */
    get held() {
      return held
    },
    /** Whether it broke: its tasks run on the main thread until `release`. */
    get broken() {
      return started === false
    },
    /** The worker retired without cutting a task in flight; the next use makes it again. */
    release() {
      held?.retire()
      held = undefined
      started = undefined
    },
  }
}
