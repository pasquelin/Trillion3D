// The dist of one side of the comparison: an already built `dist/` directory, or a git reference
// extracted outside the repository then built. Separated from `options.ts`: resolving a side is
// repository and build work, not reading arguments.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pnpmCommand } from '../only-pnpm.ts';

const buildDist = (dir: string) =>
  execFileSync(...pnpmCommand('run', 'build'), { cwd: dir, stdio: 'inherit' });

/**
 * One side of the comparison, before `equipSide` (`optionsCote.ts`) turns it into a `Side` by
 * filling its engine, variant and error metric. `dist`/`from` are set here; `cache` too, once a
 * side names its own; `manifestUrl`/`sourceUrl` are set by `banc.ts`/`oracle.ts` once the scene
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
  if (target === join(root, 'dist') && !existsSync(join(target, 'sdk-browser/index.js')))
    buildDist(root);
  const sides = [{ name: 'apres', ...resolveDist(target, 'apres', root) }];
  if (before) sides.push({ name: 'avant', ...resolveDist(before, 'avant', root) });
  return sides;
}

/** Resolves a side: an existing `dist` folder, or a git reference extracted then built.
 *  The extracted tree goes outside the repository: a second `tsconfig.json` under root would break linting. */
function resolveDist(value: string, label: string, root: string): { dist: string; from: string } {
  if (existsSync(join(value, 'sdk-browser/index.js')))
    return { dist: resolve(value), from: 'folder' };
  if (existsSync(join(value, 'dist/sdk-browser/index.js')))
    return { dist: resolve(value, 'dist'), from: 'folder' };
  const ref = execFileSync('git', ['-C', root, 'rev-parse', '--verify', `${value}^{commit}`], {
    encoding: 'utf8',
  }).trim();
  const dir = join(tmpdir(), 'web-geometry-mesure', `${label}-${ref.slice(0, 12)}`);
  if (existsSync(join(dir, 'dist/sdk-browser/index.js')))
    return { dist: join(dir, 'dist'), from: `git ${ref.slice(0, 12)} (reused)` };
  mkdirSync(dir, { recursive: true });
  execFileSync('/bin/sh', ['-c', `git -C '${root}' archive ${ref} | tar -x -C '${dir}'`]);
  execFileSync('ln', ['-sfn', join(root, 'node_modules'), join(dir, 'node_modules')]);
  buildDist(dir);
  return { dist: join(dir, 'dist'), from: `git ${ref.slice(0, 12)}` };
}
