import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MAX_LINES = 200;
const sourceFile = /\.(?:[cm]?js|[cm]?ts|jsx|tsx|rs)$/;

/**
 * `-z` est une option, pas un chemin. Placé après le `--` qui ouvre la liste des fichiers, il est
 * lu comme un chemin à filtrer : `diff --name-only <ref> -- -z` ne rend alors aucun nom, et la
 * porte de lignes déclarait « aucun fichier modifié » quoi qu'on change. Il est donc inséré avant
 * le séparateur, ou en fin d'arguments quand il n'y en a pas.
 */
export function nulSeparated(args) {
  const separator = args.indexOf('--');
  return separator === -1
    ? [...args, '-z']
    : [...args.slice(0, separator), '-z', ...args.slice(separator)];
}

function gitPaths(args) {
  return execFileSync('git', nulSeparated(args), { encoding: 'utf8' }).split('\0').filter(Boolean);
}

export function lineCount(source) {
  if (!source) return 0;
  return source.split('\n').length - Number(source.endsWith('\n'));
}

/** Every maintained source file must fit the same physical-line limit. */
export function lineLimitViolations(lines, selected = new Set(lines.keys())) {
  const errors = [];
  for (const file of selected) {
    const count = lines.get(file);
    if (count !== undefined && count > MAX_LINES)
      errors.push(`${file}: ${count} lines; maximum ${MAX_LINES}`);
  }
  return errors;
}

function main() {
  const changedOnly = process.argv.includes('--changed');
  const paths = new Set(gitPaths(['ls-files', '-co', '--exclude-standard']));
  const changed = new Set(
    changedOnly
      ? [
          ...gitPaths([
            'diff',
            '--name-only',
            process.env.WEB_GEOMETRY_BASE_REF ?? 'develop',
            '--',
          ]),
          ...gitPaths(['ls-files', '--others', '--exclude-standard']),
        ]
      : [...paths],
  );
  const lines = new Map(
    [...paths]
      .filter((file) => sourceFile.test(file) && existsSync(file))
      .map((file) => [file, lineCount(readFileSync(file, 'utf8'))]),
  );
  const selected = new Set([...changed].filter((file) => sourceFile.test(file)));
  const errors = lineLimitViolations(lines, selected);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`All checked source files have at most ${MAX_LINES} lines.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
