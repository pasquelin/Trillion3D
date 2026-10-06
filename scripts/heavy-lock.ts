import { execFileSync } from 'node:child_process'
import {
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { getPriority, setPriority } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// The heavy local steps (a test run, `build`, `build:docs`, `build:native`, `compile:caches`) of
// every worktree on the machine run one at a time, at low priority: several agents checking at once
// otherwise start dozens of processes together. The lock is a file in the main checkout's
// `.worktrees/logs/`, which every worktree shares; a lock whose process is dead is taken over. The
// CI runs each job on its own machine, and takes no lock.

/** Environment variable a lock holder passes to its children, so a nested heavy step runs inside it. */
const HELD = 'TRILLION3D_HEAVY_LOCK'

/** The niceness of a heavy step: the agents' editors and shells keep the machine's attention. */
const LOW_PRIORITY = 10

/** The machine-wide lock file: under the main checkout, whichever worktree `cwd` is in; none
 *  outside a Git checkout. */
export function heavyLockPath(cwd = process.cwd()): string | undefined {
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const main = dirname(realpathSync(resolve(cwd, common.trim())))
    return join(main, '.worktrees', 'logs', 'heavy-step.lock')
  } catch {
    return undefined
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function holder(path: string): { pid: number; step: string; cwd: string } | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Removes the lock at `path` of the dead process `dead`. The lock is first moved aside, which only
 * one waiter can do to a given file; a lock that is not the dead one's (another waiter took
 * it over first and was granted it) is put back, unless the lock was taken again meanwhile.
 */
export function takeOver(path: string, dead: number): void {
  const aside = `${path}.${process.pid}.stale`
  try {
    renameSync(path, aside)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  try {
    if (holder(aside)?.pid !== dead) linkSync(aside, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  } finally {
    unlinkSync(aside)
  }
}

const pause = new Int32Array(new SharedArrayBuffer(4))

/** Takes the lock at `path`, waiting while a live process holds it; returns the release. */
export function acquireHeavyLock(path: string, step: string, pollMs = 500): () => void {
  mkdirSync(dirname(path), { recursive: true })
  const record = JSON.stringify({ pid: process.pid, step, cwd: process.cwd() })
  let told = false
  for (;;) {
    try {
      writeFileSync(path, record, { flag: 'wx' })
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const current = holder(path)
    if (current && !alive(current.pid)) {
      takeOver(path, current.pid)
      continue
    }
    if (!told && current) {
      console.log(`Waiting for ${current.step} (pid ${current.pid}, ${current.cwd}).`)
      told = true
    }
    Atomics.wait(pause, 0, 0, pollMs)
  }
  const release = (): void => {
    if (holder(path)?.pid === process.pid) unlinkSync(path)
    process.off('exit', release)
  }
  process.on('exit', release)
  return release
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
