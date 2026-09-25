import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { gitPathsSync } from './git-paths.ts';
import { localPaths } from './local-files.ts';

const root = resolve(import.meta.dirname, '..');

/** Shared tools inspect maintained files, never ignored personal files. */
export function repositoryFiles(directory = root): string[] | null {
  if (!existsSync(resolve(directory, '.git'))) return null;
  return [
    ...new Set(
      gitPathsSync(['ls-files', '-co', '--exclude-standard', '-z'], directory).filter((file) =>
        existsSync(resolve(directory, file)),
      ),
    ),
  ];
}

/** The `.gitignore` local paths as globs: a bare name at any depth, a path from the root. */
export const localFileGlobs = (): string[] =>
  localPaths(root).map((path) => (path.includes('/') ? path : `**/${path}`));
