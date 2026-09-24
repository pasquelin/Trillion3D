// The dist of one side of the comparison: an already built `dist/` directory, or a git reference
// extracted outside the repository then built. Separated from `options.ts`: resolving a side is
// repository and build work, not reading arguments.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pnpmCommand } from '../../scripts/only-pnpm.ts';

const buildDist = (dir: string) =>
  execFileSync(...pnpmCommand('run', 'build'), { cwd: dir, stdio: 'inherit' });

/**
 * One side of the comparison, before `equipSide` (`sideOptions.ts`) turns it into a `Side` by
 * filling its engine, variant and error metric. `dist`/`from` are set here; `cache` too, once a
 * side names its own; `manifestUrl`/`sourceUrl` are set by `bench.ts`/`oracle.ts` once the scene
 * and cache are known.
 */
export interface SideBase {
  name: string;
  dist: string;
  from: string;
  cache?: string;
  manifestUrl?: string;
  sourceUrl?: string | null;
}

/** Requested sides: "apres" always, "avant" only if named. */
export function resolveSides({
  after,
  before,
  root,
}: {
  after?: string;
  before?: string;
  root: string;
}): SideBase[] {
  const target = after ?? join(root, 'dist');
  // The repository's own dist is rebuilt when it lacks the witness entry: a dist built before the
  // witnesses left the package would otherwise be served without them.
  if (target === join(root, 'dist') && !existsSync(join(target, BROWSER_ENTRIES[0])))
    buildDist(root);
  const sides = [{ name: 'apres', ...resolveDist(target, 'apres', root) }];
  if (before) sides.push({ name: 'avant', ...resolveDist(before, 'avant', root) });
  return sides;
}

/** Resolves a side: an existing `dist` folder, or a git reference extracted then built.
 *  The extracted tree goes outside the repository: a second `tsconfig.json` under root would break linting. */
function resolveDist(value: string, label: string, root: string): { dist: string; from: string } {
  if (isDist(value)) return { dist: resolve(value), from: 'folder' };
  if (isDist(join(value, 'dist'))) return { dist: resolve(value, 'dist'), from: 'folder' };
  const ref = execFileSync('git', ['-C', root, 'rev-parse', '--verify', `${value}^{commit}`], {
    encoding: 'utf8',
  }).trim();
  const dir = join(tmpdir(), 'trillion3d-mesure', `${label}-${ref.slice(0, 12)}`);
  if (isDist(join(dir, 'dist')))
    return { dist: join(dir, 'dist'), from: `git ${ref.slice(0, 12)} (reused)` };
  mkdirSync(dir, { recursive: true });
  execFileSync('/bin/sh', ['-c', `git -C '${root}' archive ${ref} | tar -x -C '${dir}'`]);
  execFileSync('ln', ['-sfn', join(root, 'node_modules'), join(dir, 'node_modules')]);
  buildDist(dir);
  return { dist: join(dir, 'dist'), from: `git ${ref.slice(0, 12)}` };
}

/**
 * The browser entries a built dist may carry, newest layout first: the witness entry
 * (`dist/witnesses/`, built by `scripts/build-witnesses.ts` since the witnesses left the package),
 * then the measurement entry that still named the witnesses itself, under `src/` since the package
 * sources are foldered, then at the package root as a dist built before that move has it, then the
 * published entry of a dist built before the measurement entry existed, which named the witnesses
 * itself. A bench side is often a reference built from an older commit, so every layout it may
 * carry is read.
 */
const BROWSER_ENTRIES = [
  'witnesses/measurement.js',
  'sdk-browser/src/measurement/measurement.js',
  'sdk-browser/measurement.js',
  'sdk-browser/src/index.js',
  'sdk-browser/index.js',
];

/** Whether `dir` is a built dist: it holds one of the browser entries. */
const isDist = (dir: string) => BROWSER_ENTRIES.some((entry) => existsSync(join(dir, entry)));

/** The page-side address of a side's SDK: the first browser entry its dist carries. */
export const sdkEntryUrl = (side: { name: string; dist: string }) =>
  `/sdk/${side.name}/${BROWSER_ENTRIES.find((entry) => existsSync(join(side.dist, entry))) ?? BROWSER_ENTRIES[0]}`;
