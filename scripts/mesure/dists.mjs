// The dist of one side of the comparison: an already built `dist/` directory, or a git reference
// extracted outside the repository then built. Separated from `options.mjs`: resolving a side is
// repository and build work, not reading arguments.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pnpmCommand } from '../only-pnpm.mjs';

const buildDist = (dir) =>
  execFileSync(...pnpmCommand('run', 'build'), { cwd: dir, stdio: 'inherit' });

/** Requested sides: "apres" always, "avant" only if named. */
export function resolveSides({ after, before, root }) {
  const target = after ?? join(root, 'dist');
  if (target === join(root, 'dist') && !existsSync(join(target, 'sdk-browser/index.js')))
    buildDist(root);
  const sides = [{ name: 'apres', ...resolveDist(target, 'apres', root) }];
  if (before) sides.push({ name: 'avant', ...resolveDist(before, 'avant', root) });
  return sides;
}

/** Resolves a side: an existing `dist` folder, or a git reference extracted then built.
 *  The extracted tree goes outside the repository: a second `tsconfig.json` under root would break linting. */
function resolveDist(value, label, root) {
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
