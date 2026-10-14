import { realpathSync } from 'node:fs'
import { getPriority, setPriority } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { git } from './git-paths.ts'
import { processAlive, tryLock } from './machine-lock.ts'

// The heavy local steps (a test run, `build`, `build:native`, `compile:caches`) of
// every worktree on the machine run one at a time, at low priority: several agents checking at once
// otherwise start dozens of processes together. The lock is a file in the main checkout's
// `.worktrees/logs/`, which every worktree shares, taken as every machine lock is
// (`scripts/machine-lock.ts`): a lock whose process is dead is taken over. The CI runs each job on
// its own machine, and takes no lock.

/** Environment variable a lock holder passes to its children, so a nested heavy step runs inside it. */
const HELD = 'TRILLION3D_HEAVY_LOCK'

/** The niceness of a heavy step: the agents' editors and shells keep the machine's attention. */
const LOW_PRIORITY = 10

/** The machine-wide lock file: under the main checkout, whichever worktree `cwd` is in; none
 *  outside a Git checkout. */
export function heavyLockPath(cwd = process.cwd()): string | undefined {
  try {
    const common = git(cwd, 'rev-parse', '--git-common-dir')
    const main = dirname(realpathSync(resolve(cwd, common)))
    return join(main, '.worktrees', 'logs', 'heavy-step.lock')
  } catch {
    return undefined
  }
}

const pause = new Int32Array(new SharedArrayBuffer(4))

/** Takes the lock at `path`, waiting while a live process holds it; returns the release. */
export function acquireHeavyLock(path: string, step: string, pollMs = 500): () => void {
  const holder = { pid: process.pid, step, cwd: process.cwd() }
  let told = false
  for (;;) {
    const taken = tryLock(path, holder, processAlive)
    if (taken && 'release' in taken) {
      const release = (): void => {
        taken.release()
        process.off('exit', release)
      }
      process.on('exit', release)
      return release
    }
    if (!told && taken) {
      const current = taken.holder
      console.log(`Waiting for ${current.step} (pid ${current.pid}, ${current.cwd}).`)
      told = true
    }
    Atomics.wait(pause, 0, 0, pollMs)
  }
}

/**
 * Runs `work`, a heavy step named `step`, alone on the machine and at low priority when local; the
 * processes it starts inherit both, and a nested heavy step runs inside the lock already held. The
 * lock is released when `work` returns, or when the promise it returns settles.
 */
export function heavyStep<T>(step: string, work: () => T, env = process.env): T {
  const path = !env.CI && !env[HELD] ? heavyLockPath() : undefined
  if (!path) return work()
  setPriority(Math.max(LOW_PRIORITY, getPriority()))
  const release = acquireHeavyLock(path, step)
  env[HELD] = String(process.pid)
  const done = (): void => {
    delete env[HELD]
    release()
  }
  let pending = false
  try {
    const result = work()
    if (result instanceof Promise) {
      pending = true
      return result.finally(done) as T
    }
    return result
  } finally {
    if (!pending) done()
  }
}
