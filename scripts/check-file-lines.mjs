import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gitPaths as readGitPaths } from './git-paths.mjs';

export const MAX_LINES = 200;
const sourceFile = /\.(?:[cm]?js|[cm]?ts|jsx|tsx|rs)$/;

/**
 * `-z` is an option, not a path. Placed after the `--` that opens the list of files, it is
 * read as a path to filter: `diff --name-only <ref> -- -z` then returns no names, and the
 * line check declared "no files modified" whatever we change. It is therefore inserted before
 * the separator, or at the end of arguments when there is none.
 */
export function nulSeparated(args) {
  const separator = args.indexOf('--');
  return separator === -1
    ? [...args, '-z']
    : [...args.slice(0, separator), '-z', ...args.slice(separator)];
}

function gitPaths(args) {
  return readGitPaths(nulSeparated(args));
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

async function main() {
  const changedOnly = process.argv.includes('--changed');
  const paths = new Set(await gitPaths(['ls-files', '-co', '--exclude-standard']));
  const changed = new Set(
    changedOnly
      ? [
          ...(await gitPaths([
            'diff',
            '--name-only',
            process.env.WEB_GEOMETRY_BASE_REF ?? 'develop',
            '--',
          ])),
          ...(await gitPaths(['ls-files', '--others', '--exclude-standard'])),
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
