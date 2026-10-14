// One holder at a time per machine for a lock file: the GPU bench lock (`bench/dawn/lock.ts`) and
// the heavy-step lock (`scripts/heavy-lock.ts`) are two policies over this one mechanism. The holder
// is a JSON record naming its process; a holder whose process is dead is taken over.
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { readJson } from './repository-files.ts'

/** What a lock's holder writes in it: its process, and what its policy adds. */
type Holder = { pid: number }

/** The holder written in the lock at `path`, or `null` for none or an unreadable one. */
export function lockHolder<T extends Holder>(path: string): T | null {
  try {
    const holder = readJson(path) as T
    return Number.isInteger(holder.pid) ? holder : null
  } catch {
    return null
  }
}

/** Whether process `pid` runs: one another user owns still does (`EPERM`). */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Puts `holder` at `path` whole, or reports the place taken: the holder is written to this
 * process's own file first, then linked in. A lock therefore never shows half written, and a link,
 * unlike a rename, never replaces a lock another process holds.
 */
function linkHolder(path: string, holder: string): boolean {
  const own = `${path}.${process.pid}.new`
  writeFileSync(own, holder)
  try {
    linkSync(own, path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  } finally {
    rmSync(own, { force: true })
  }
}

/** Takes a dead holder's lock away, once: a rename only one process wins. The renamed lock is
 *  checked to be the dead one it read — a live holder may have taken the lock meanwhile, and its
 *  lock is linked back, never renamed over a lock a third process took in between; that live
 *  holder is returned. */
function clearDead<T extends Holder>(
  path: string,
  dead: T | null,
  alive: (pid: number) => boolean,
): T | null {
  const aside = `${path}.${process.pid}.dead`
  try {
    renameSync(path, aside)
  } catch {
    return null // gone already: the next attempt reads whoever holds it now
  }
  try {
    const moved = lockHolder<T>(aside)
    if (moved && moved.pid !== dead?.pid && alive(moved.pid)) {
      linkHolder(path, readFileSync(aside, 'utf8'))
      return moved
    }
    return null
  } finally {
    rmSync(aside, { force: true })
  }
}

/** A lock taken: `release` frees it, once, and says whether it was still this process's; a lock
 *  another process holds by then is left in place. */
type Taken = { release: () => boolean }

/**
 * Takes the lock at `path` for `holder` (this process's record) at once, or returns the live
 * holder that has it — live by `alive`, which a policy may make stricter than a running process.
 * A dead holder's lock is taken over. `null` when three attempts all lost a race.
 */
export function tryLock<T extends Holder>(
  path: string,
  holder: T,
  alive: (pid: number) => boolean,
): Taken | { holder: T } | null {
  mkdirSync(dirname(path), { recursive: true })
  const record = JSON.stringify(holder)
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!linkHolder(path, record)) {
      const current = lockHolder<T>(path)
      if (current && current.pid !== process.pid && alive(current.pid)) return { holder: current }
      const taken = clearDead(path, current, alive)
      if (taken) return { holder: taken }
      continue
    }
    let held = true
    const release = () => {
      if (!held) return true
      held = false
      if (lockHolder(path)?.pid !== process.pid) return false
      rmSync(path, { force: true })
      return true
    }
    return { release }
  }
  return null
}
