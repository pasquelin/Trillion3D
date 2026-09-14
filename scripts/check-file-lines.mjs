import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MAX_LINES = 200;
const sourceFile = /\.(?:[cm]?js|[cm]?ts|jsx|tsx|rs)$/;

function gitPaths(args) {
  return execFileSync('git', [...args, '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
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
