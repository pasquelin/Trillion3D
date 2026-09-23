import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { gitPaths } from './git-paths.ts';
import { repositoryFiles } from './repository-files.ts';

const sourcePattern = /\.(?:[cm]?ts|tsx)$/;
const testPattern = /\.test\.(?:ts|mts)$/;
const formatPattern = /\.(?:[cm]?ts|tsx|json)$/;

function candidates(importer: string, specifier: string): string[] {
  if (specifier === 'web-geometry')
    return ['packages/sdk/index.ts', 'packages/sdk/browser.ts', 'packages/sdk/node.mts'];
  if (!specifier.startsWith('.')) return [];
  const target = posix.normalize(posix.join(posix.dirname(importer), specifier));
  const stem = target.replace(/\.m?ts$/, '');
  return [target, `${stem}.ts`, `${stem}.mts`, `${stem}/index.ts`];
}

/** Direct and transitive source imports select only the unit tests they can affect. */
export function relatedTests(files: Map<string, string>, changed: Set<string>): string[] {
  const edges = new Map<string, string[]>();
  for (const [file, content] of files) {
    if (!sourcePattern.test(file)) continue;
    const imports = ts.preProcessFile(content, true, true).importedFiles;
    edges.set(
      file,
      imports.flatMap(({ fileName }) =>
        candidates(file, fileName).filter((path) => files.has(path) || changed.has(path)),
      ),
    );
  }
  const reachesChanged = (file: string, visited: Set<string> = new Set()): boolean => {
    if (changed.has(file)) return true;
    if (visited.has(file)) return false;
    visited.add(file);
    return (edges.get(file) ?? []).some((dependency) => reachesChanged(dependency, visited));
  };
  return [...files.keys()]
    .filter(
      (file) =>
        testPattern.test(file) &&
        (file.startsWith('packages/') ||
          file.startsWith('bench/') ||
          file.startsWith('tests/') ||
          changed.has(file)),
    )
    .filter((file) => reachesChanged(file))
    .sort();
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export function existingChangedFiles(changed: Iterable<string>, root = process.cwd()): string[] {
  const maintained = new Set(repositoryFiles(root));
  return [...changed].filter((file) => maintained.has(file));
}

async function main(): Promise<void> {
  const base = process.env.WEB_GEOMETRY_BASE_REF ?? 'develop';
  const changed = new Set([
    ...(await gitPaths(['diff', '--name-only', '-z', base, '--'])),
    ...(await gitPaths(['ls-files', '--others', '--exclude-standard', '-z'])),
  ]);
  const existing = existingChangedFiles(changed);
  const paths = await gitPaths(['ls-files', '-z']);
  const files = new Map(
    [...new Set([...paths, ...existing])]
      .filter((file) => sourcePattern.test(file) && existsSync(file))
      .map((file): [string, string] => [file, readFileSync(file, 'utf8')]),
  );
  const tests = relatedTests(files, changed);
  const testFiles = tests;
  console.log(`Changed files: ${existing.length}; related tests: ${testFiles.length}`);
  if (!process.argv.includes('--tests-only')) {
    run('node', ['scripts/check-file-lines.ts', '--changed']);
    const formatted = existing.filter((file) => formatPattern.test(file));
    const linted = existing.filter((file) => sourcePattern.test(file));
    const duplicateCandidates = existing.filter(
      (file) => sourcePattern.test(file) || file.endsWith('.rs'),
    );
    if (formatted.length) run('node_modules/.bin/prettier', ['--check', ...formatted]);
    if (linted.length) run('node_modules/.bin/eslint', linted);
    if (duplicateCandidates.length)
      run('node_modules/.bin/jscpd', [
        ...duplicateCandidates,
        '--format',
        'typescript,javascript,rust',
        '--cross-formats',
        'js-ts',
        '--min-lines',
        '8',
        '--min-tokens',
        '64',
        '--reporters',
        'console',
        '--exit-code',
        '1',
        '--no-tips',
      ]);
    if (existing.some((file) => file.endsWith('.rs'))) {
      run('cargo', [
        'fmt',
        '--all',
        '--manifest-path',
        'packages/asset-compiler-rust/Cargo.toml',
        '--',
        '--check',
      ]);
      run('cargo', [
        'clippy',
        '--release',
        '--locked',
        '--manifest-path',
        'packages/asset-compiler-rust/Cargo.toml',
        '--all-targets',
        '--',
        '-D',
        'warnings',
      ]);
    }
  }
  if (testFiles.length) {
    run('node', ['--experimental-strip-types', '--test', ...testFiles]);
  } else
    console.log('No directly related unit test; the final validation still runs the full suite.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
