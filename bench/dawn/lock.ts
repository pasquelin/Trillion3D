// One GPU bench at a time on this machine: two benches share the GPU, and both would read false.
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { exitOnSignals } from './child.ts'
import { lockHolder, processAlive, tryLock } from '../../scripts/machine-lock.ts'

/** The machine's one bench lock: in the home directory, so every clone and worktree sees it. */
const BENCH_LOCK = join(homedir(), '.trillion3d', 'gpu-bench.lock')

/** A bench run's children name the run that holds the lock for them (`takeBenchLock`). */
export const LOCK_OWNER = 'TRILLION3D_BENCH_LOCK_OWNER'

/** Who holds the lock: its process, since when, and what it measures. */
export type LockHolder = { pid: number; since: string; what: string }

/** Whether `pid` is a live bench process: alive, and running a bench or a GPU proof, so a pid the
 *  system gave again to another program does not hold the machine for ever. */
export function benchAlive(pid: number) {
  if (!processAlive(pid)) return false
  try {
    return /\b(?:bench\/(?:dawn|runner)|tests\/gpu)\//.test(
      execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }),
    )
  } catch {
    return false
  }
}

const busy = (holder: LockHolder) =>
  new Error(
    `GPU_BENCH_BUSY: bench pid ${holder.pid} measures ${holder.what} since ${holder.since}; ` +
      'one bench at a time, or both read false',
  )

/**
 * Takes the machine's bench lock for `what`, or throws `GPU_BENCH_BUSY` naming the bench that
 * holds it. A lock whose holder died is taken over. A child of a run that holds the lock (`LOCK_OWNER`
 * set to that run's pid) shares it. Returns the release, also run when the process exits.
 */
export function takeBenchLock(what: string, path = BENCH_LOCK): () => void {
  const owner = Number(process.env[LOCK_OWNER])
  if (owner) {
    const holder = lockHolder<LockHolder>(path)
    if (holder?.pid === owner) return () => {}
    throw new Error(`GPU_BENCH_LOCK: the run ${owner} that started this bench holds no lock`)
  }
  const holder = { pid: process.pid, since: new Date().toISOString(), what }
  const taken = tryLock<LockHolder>(path, holder, benchAlive)
  if (!taken) throw new Error('GPU_BENCH_LOCK: the lock could not be taken')
  if ('holder' in taken) throw busy(taken.holder)
  const release = () => {
    if (taken.release()) return
    // Only a lock cleared under a live bench gets here: this run shared the GPU with another.
    const now = lockHolder(path)
    console.error(
      `GPU_BENCH_LOCK_LOST: pid ${now?.pid ?? 'none'} held the lock before this run ended`,
    )
    process.exitCode = 1
  }
  process.once('exit', release)
  exitOnSignals()
  return release
}

/** Takes the lock as `takeBenchLock` does, waiting while another live bench holds it: tried again
 *  every `everyMs`, given up past `timeoutMs` with the holder's `GPU_BENCH_BUSY`. */
export async function waitBenchLock(
  what: string,
  { timeoutMs = 3 * 3600_000, everyMs = 2_000, path = BENCH_LOCK } = {},
) {
  const until = Date.now() + timeoutMs
  for (;;) {
    try {
      return takeBenchLock(what, path)
    } catch (error) {
      if (!(error as Error).message.startsWith('GPU_BENCH_BUSY') || Date.now() + everyMs > until)
        throw error
    }
    await sleep(everyMs)
  }
}
