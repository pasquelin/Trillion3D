import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/** Shared tools inspect maintained files, never ignored personal files. */
export function repositoryFiles(directory = root) {
  if (!existsSync(resolve(directory, '.git'))) return null;
  return [
    ...new Set(
      execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
        cwd: directory,
        encoding: 'utf8',
      })
        .split('\0')
        .filter((file) => file && existsSync(resolve(directory, file))),
    ),
  ];
}

/** The local section uses basename patterns or root-relative paths, without negations. */
export function localFileGlobs() {
  const policy = readFileSync(resolve(root, '.gitignore'), 'utf8');
  return policy
    .split('# Local files begin\n')[1]
    .split('# Local files end')[0]
    .trim()
    .split('\n')
    .map((pattern) => {
      const prefix = pattern.startsWith('/') ? '' : '**/';
      return prefix + pattern.replace(/^\//, '') + (pattern.endsWith('/') ? '**' : '');
    });
}
