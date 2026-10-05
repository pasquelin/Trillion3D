// The engine a bench run measures: a checkout of the repository, by default this one, and a clean
// commit of it — a run reads the sources as they are on disk, and a file another session is
// writing would make its numbers no commit's. Two checkouts of two commits, one scenario: an A/B.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RACINE } from '../core/paths.ts';

const git = (root: string, ...args: string[]) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

/** What the engine and the pages it runs are read from. */
export type EngineRoot = { root: string; commit: string; subject: string; dirty: string[] };

/**
 * The checkout at `dir` (the bench's own repository when unset): its commit, and the files of the
 * engine and the site that differ from it. A run on a dirty checkout is refused unless `dirtyOk`.
 */
export function engineRoot(dir: string | undefined, dirtyOk: boolean): EngineRoot {
  const root = resolve(dir ?? RACINE);
  if (!existsSync(join(root, 'packages', 'sdk-browser', 'src', 'index.ts')))
    throw new Error(`BENCH_ENGINE: ${root} holds no engine (packages/sdk-browser/src/index.ts)`);
  const dirty = git(root, 'status', '--porcelain', '--', 'packages', 'site')
    .split('\n')
    .filter(Boolean)
    // Scene caches are built beside the scenes and never committed.
    .filter((line) => !/\/cache(-none)?\/?$/.test(line));
  if (dirty.length && !dirtyOk)
    throw new Error(
      `BENCH_ENGINE_DIRTY: ${root} has ${dirty.length} changed engine or site files (${dirty
        .slice(0, 3)
        .join('; ')}…): measure a clean checkout (--engine .worktrees/831-serve), or --dirty`,
    );
  return {
    root,
    commit: git(root, 'rev-parse', 'HEAD'),
    subject: git(root, 'log', '-1', '--format=%s'),
    dirty,
  };
}
