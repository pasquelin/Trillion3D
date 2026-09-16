import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const sourcePattern = /\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/;
const testPattern = /\.test\.(?:ts|mts|mjs)$/;
const formatPattern = /\.(?:[cm]?js|[cm]?ts|jsx|tsx|json)$/;

function gitPaths(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);
}

function candidates(importer, specifier) {
  if (specifier.startsWith('@web-geometry/sdk')) {
    const entry = specifier.slice('@web-geometry/sdk'.length);
    if (entry === '/core') return ['packages/sdk-core/index.ts'];
    if (entry === '/browser') return ['packages/sdk-browser/index.ts'];
    if (entry === '/node') return ['packages/sdk-node/index.mts'];
    if (!entry)
      return [
        'packages/sdk-core/index.ts',
        'packages/sdk-browser/index.ts',
        'packages/sdk-node/index.mts',
      ];
  }
  if (!specifier.startsWith('.')) return [];
  const target = posix.normalize(posix.join(posix.dirname(importer), specifier));
  const stem = target.replace(/\.(?:m?js)$/, '');
  return [target, `${stem}.ts`, `${stem}.mts`, `${stem}.mjs`, `${stem}/index.ts`];
}

/** Direct and transitive source imports select only the unit tests they can affect. */
export function relatedTests(files, changed) {
  const edges = new Map();
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
  const reachesChanged = (file, visited = new Set()) => {
    if (changed.has(file)) return true;
    if (visited.has(file)) return false;
    visited.add(file);
    return (edges.get(file) ?? []).some((dependency) => reachesChanged(dependency, visited));
  };
  return [...files.keys()]
    .filter(
      (file) =>
        testPattern.test(file) &&
        (file.startsWith('packages/') || file.startsWith('scripts/mesure/') || changed.has(file)),
    )
    .filter((file) => reachesChanged(file))
    .sort();
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function main() {
  const base = process.env.WEB_GEOMETRY_BASE_REF ?? 'develop';
  const changed = new Set([
    ...gitPaths(['diff', '--name-only', '-z', base, '--']),
    ...gitPaths(['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  const existing = [...changed].filter((file) => existsSync(file));
  const paths = gitPaths(['ls-files', '-z']);
  const files = new Map(
    [...new Set([...paths, ...existing])]
      .filter((file) => sourcePattern.test(file) && existsSync(file))
      .map((file) => [file, readFileSync(file, 'utf8')]),
  );
  const tests = relatedTests(files, changed);
  const testFiles = tests;
  console.log(`Changed files: ${existing.length}; related tests: ${testFiles.length}`);
  if (!process.argv.includes('--tests-only')) {
    run('node', ['scripts/check-file-lines.mjs', '--changed']);
    const formatted = existing.filter(
      (file) => formatPattern.test(file) && file !== 'package-lock.json',
    );
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
        '12',
        '--min-tokens',
        '100',
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
  if (testFiles.length) run('node', ['--experimental-strip-types', '--test', ...testFiles]);
  else
    console.log('No directly related unit test; the final validation still runs the full suite.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
