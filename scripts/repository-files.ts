import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { gitPathsSync } from './git-paths.ts';
import { localPaths } from './local-files.ts';

const root = resolve(import.meta.dirname, '..');

const frozenDependencies = ['cadmpeg-codec-rhino', 'serde-json-legacy'].map(
  (name) => `packages/asset-compiler-rust/vendor/${name}/`,
);

/** Frozen dependencies, reviewed by recorded upstream deltas and native regressions.
 * Their PATCH.md files remain maintained repository documentation. */
export const isVendoredDependency = (file: string): boolean =>
  frozenDependencies.some((root) => file.startsWith(root) && file !== `${root}PATCH.md`);

/** Shared tools inspect maintained files, never ignored personal or vendored dependency files. */
export function repositoryFiles(directory = root): string[] | null {
  if (!existsSync(resolve(directory, '.git'))) return null;
  return [
    ...new Set(
      gitPathsSync(['ls-files', '-co', '--exclude-standard', '-z'], directory).filter(
        (file) => existsSync(resolve(directory, file)) && !isVendoredDependency(file),
      ),
    ),
  ];
}

/** The `.gitignore` local paths as globs: a bare name at any depth, a path from the root. */
export const localFileGlobs = (): string[] =>
  localPaths(root).map((path) => (path.includes('/') ? path : `**/${path}`));
