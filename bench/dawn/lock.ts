// One GPU bench at a time on this machine: two benches share the GPU, and both would read false.
import { execFileSync } from 'node:child_process';
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { exitOnSignals } from './child.ts';

/** The machine's one bench lock: in the home directory, so every clone and worktree sees it. */
const BENCH_LOCK = join(homedir(), '.trillion3d', 'gpu-bench.lock');

/** A bench run's children name the run that holds the lock for them (`takeBenchLock`). */
export const LOCK_OWNER = 'TRILLION3D_BENCH_LOCK_OWNER';

/** Who holds the lock: its process, since when, and what it measures. */
export type LockHolder = { pid: number; since: string; what: string };

/** The holder written in the lock, or `null` for none or an unreadable one. */
export function lockHolder(path = BENCH_LOCK): LockHolder | null {
  try {
    const holder = JSON.parse(readFileSync(path, 'utf8')) as LockHolder;
    return Number.isInteger(holder.pid) ? holder : null;
  } catch {
    return null;
  }
}

/** Whether `pid` is a live bench process: alive, and running a bench or a GPU proof, so a pid the
 *  system gave again to another program does not hold the machine for ever. */
export function benchAlive(pid: number) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') return false;
  }
  try {
    return /\b(?:bench\/(?:dawn|runner)|tests\/gpu)\//.test(
      execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }),
    );
  } catch {
    return false;
  }
}

const busy = (holder: LockHolder) =>
  new Error(
    `GPU_BENCH_BUSY: bench pid ${holder.pid} measures ${holder.what} since ${holder.since}; ` +
      'one bench at a time, or both read false',
  );

/**
 * Puts `holder` at `path` whole, or reports the place taken: the holder is written to this
 * process's own file first, then linked in. A lock therefore never shows half written, and a link,
 * unlike a rename, never replaces a lock another bench holds.
 */
function linkHolder(path: string, holder: string) {
  const own = `${path}.${process.pid}.new`;
  writeFileSync(own, holder);
  try {
    linkSync(own, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  } finally {
    rmSync(own, { force: true });
  }
}

/** Takes a dead holder's lock away, once: a rename only one process wins. The renamed lock is
 *  checked to be the dead one it read — a live bench may have taken the lock meanwhile, and its
 *  lock is linked back, never renamed over a lock a third bench took in between. */
function clearDead(path: string, dead: LockHolder | null) {
  const aside = `${path}.${process.pid}.dead`;
  try {
    renameSync(path, aside);
  } catch {
    return; // gone already: the next attempt reads whoever holds it now
  }
  try {
    const moved = lockHolder(aside);
    if (moved && moved.pid !== dead?.pid && benchAlive(moved.pid)) {
      linkHolder(path, readFileSync(aside, 'utf8'));
      throw busy(moved);
    }
  } finally {
    rmSync(aside, { force: true });
  }
}

/**
 * Takes the machine's bench lock for `what`, or throws `GPU_BENCH_BUSY` naming the bench that
 * holds it. A lock whose holder died is taken over. A child of a run that holds the lock (`LOCK_OWNER`
 * set to that run's pid) shares it. Returns the release, also run when the process exits.
 */
export function takeBenchLock(what: string, path = BENCH_LOCK): () => void {
  const owner = Number(process.env[LOCK_OWNER]);
  if (owner) {
    const holder = lockHolder(path);
    if (holder?.pid === owner) return () => {};
    throw new Error(`GPU_BENCH_LOCK: the run ${owner} that started this bench holds no lock`);
  }
  mkdirSync(dirname(path), { recursive: true });
  const holder = JSON.stringify({ pid: process.pid, since: new Date().toISOString(), what });
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!linkHolder(path, holder)) {
      const current = lockHolder(path);
      if (current && current.pid !== process.pid && benchAlive(current.pid)) throw busy(current);
      clearDead(path, current);
      continue;
    }
    let held = true;
    const release = () => {
      if (!held) return;
      held = false;
      const now = lockHolder(path);
      if (now?.pid === process.pid) rmSync(path, { force: true });
      else {
        // Only a lock cleared under a live bench gets here: this run shared the GPU with another.
        console.error(
          `GPU_BENCH_LOCK_LOST: pid ${now?.pid ?? 'none'} held the lock before this run ended`,
        );
        process.exitCode = 1;
      }
    };
    process.once('exit', release);
    exitOnSignals();
    return release;
  }
  throw new Error('GPU_BENCH_LOCK: the lock could not be taken');
}
