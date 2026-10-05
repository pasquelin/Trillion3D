import test from 'node:test';
import assert from 'node:assert/strict';
import { unitOf } from './check-cohesion-measure.ts';
import {
  keepsLineBound,
  lineCount,
  lineLimitViolations,
  nulSeparated,
} from './check-file-lines.ts';

test('the null separator is an option, never a path behind the `--`', () => {
  // The fixed defect: `-z` placed at the end of arguments became the only filtered path, and the list
  // of modified files returned empty whatever we change.
  assert.deepEqual(nulSeparated(['diff', '--name-only', 'develop', '--']), [
    'diff',
    '--name-only',
    'develop',
    '-z',
    '--',
  ]);
  assert.deepEqual(nulSeparated(['ls-files', '-co', '--exclude-standard']), [
    'ls-files',
    '-co',
    '--exclude-standard',
    '-z',
  ]);
});

test('counts physical lines, including an unterminated final line', () => {
  assert.equal(lineCount('one\ntwo\n'), 2);
  assert.equal(lineCount('one\ntwo'), 2);
  assert.equal(lineCount(''), 0);
});

test('rejects every oversized file, including existing files', () => {
  const lines = new Map([
    ['new.ts', 201],
    ['old.rs', 5309],
    ['small.mjs', 200],
  ]);
  const errors = lineLimitViolations(lines);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /new.ts: 201 lines/);
  assert.match(errors[1], /old.rs: 5309 lines/);
});

test('checks only selected files during a targeted run', () => {
  const errors = lineLimitViolations(
    new Map([
      ['large.ts', 300],
      ['changed.ts', 199],
    ]),
    new Set(['changed.ts']),
  );
  assert.deepEqual(errors, []);
});

test('a runtime module is read by the cohesion gate instead, and is not reported here', () => {
  // The whole point of the change: a 400-line runtime module is not a line-limit failure, it is a
  // `check:cohesion` question about the functions inside it.
  const runtime = 'packages/sdk-browser/src/webgpu/tile/wgsl.ts';
  assert.equal(keepsLineBound(runtime), false);
  assert.deepEqual(lineLimitViolations(new Map([[runtime, 400]])), []);
});

test('a test, a fixture and an index keep the bound: they are read whole', () => {
  for (const file of [
    'packages/sdk-browser/src/gpu/dag/uniforms.test.ts',
    'packages/sdk-browser/src/gpu/dag/uniforms.fixture.ts',
    'packages/sdk-browser/src/gpu/dag/index.ts',
  ]) {
    assert.equal(keepsLineBound(file), true, file);
    assert.equal(lineLimitViolations(new Map([[file, 400]])).length, 1, file);
  }
});

test('the `page-codec` modules are read by the cohesion gate', () => {
  // The two lists must agree: a path `check-file-lines` exempts and `check:cohesion` never reads
  // would leave a file with no gate at all.
  assert.equal(keepsLineBound('packages/page-codec/src/geometryPage.ts'), false);
  assert.equal(unitOf('packages/page-codec/src/geometryPage.ts') !== null, true);
  assert.equal(keepsLineBound('packages/sdk-node/src/cli/cli.mts'), false);
  // A barrel keeps the bound and is read by the cohesion gate too: the overlap is harmless, and
  // what matters is that no file is read by neither.
  assert.equal(keepsLineBound('packages/sdk-node/src/index.mts'), true);
  assert.equal(unitOf('packages/sdk-node/src/index.mts') !== null, true);
});

test('a Rust crate, a script, the site and the bench all keep the bound', () => {
  for (const file of [
    'packages/asset-compiler-rust/src/dag/layout.rs',
    'scripts/check-file-lines.ts',
    'site/app/main.tsx',
    'bench/core/index.ts',
    'tests/integration/engine-structure.test.ts',
  ]) {
    assert.equal(keepsLineBound(file), true, file);
    assert.equal(lineLimitViolations(new Map([[file, 400]])).length, 1, file);
  }
});
