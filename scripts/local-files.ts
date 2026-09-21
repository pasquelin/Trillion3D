import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const BEGIN = '# Local files begin';
const END = '# Local files end';

/**
 * The paths `.gitignore` declares local: personal instructions, assistant roles and graph
 * artefacts, kept out of the index by #157 and therefore absent from a fresh worktree. The block
 * marks its own bounds because shared checks read it; this is the only list, never a second copy.
 * Patterns are taken as plain paths, so a wildcard — which no entry uses today — is left out
 * rather than guessed at.
 */
export function localPaths(root: string): string[] {
  const file = join(root, '.gitignore');
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split('\n');
  const begin = lines.indexOf(BEGIN);
  const end = lines.indexOf(END);
  if (begin === -1 || end <= begin) return [];
  return lines
    .slice(begin + 1, end)
    .map((line) => line.trim().replace(/^\/+/, '').replace(/\/+$/, ''))
    .filter((line) => line !== '' && !line.startsWith('#') && !line.includes('*'));
}

/** Whether `path` exists, a broken symbolic link included — which `existsSync` reports as absent. */
function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Links into `root` every local path the primary worktree `main` actually has, and reports what it
 * linked. A path already in `root` is left untouched, a path absent from `main` creates nothing:
 * the tree gains the rules it is told to obey, and nothing else changes.
 */
export function linkLocalFiles(root: string, main: string): string[] {
  if (resolve(root) === resolve(main)) return [];
  const linked: string[] = [];
  for (const path of localPaths(main)) {
    const source = join(main, path);
    const target = join(root, path);
    if (!present(source) || present(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(source, target);
    linked.push(path);
  }
  return linked;
}
