import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_COMPLEXITY, MAX_FUNCTION_LINES, overBound } from './check-cohesion.ts';
import { functionsOf, isTestModule, unitOf } from './check-cohesion-measure.ts';

const bound = { lines: MAX_FUNCTION_LINES, complexity: MAX_COMPLEXITY };
const inPackage = (name: string, text: string) =>
  new Map([[`packages/sdk-core/src/${name}`, text]]);

/** A function of `lines` physical lines, one statement each so the count is the only variable. */
const long = (lines: number) =>
  `export function wide() {\n${Array.from({ length: lines - 2 }, (_, i) => `  step${i}();`).join('\n')}\n}\n`;

/** A function of `branches` paths, each an `if`, so the complexity is the only variable. */
const branched = (branches: number) =>
  `export function deep(a: number) {\n${Array.from({ length: branches }, (_, i) => `  if (a === ${i}) return ${i};`).join('\n')}\n  return 0;\n}\n`;

test('a function over the line bound is red, and names the file, the line and the function', () => {
  const over = overBound(inPackage('wide.ts', long(MAX_FUNCTION_LINES + 1)), bound);
  assert.equal(over.length, 1);
  assert.match(over[0], /^packages\/sdk-core\/src\/wide\.ts:1 wide is \d+ lines$/);
});

test('a function over the complexity bound is red, and says what it measures', () => {
  const over = overBound(inPackage('deep.ts', branched(MAX_COMPLEXITY + 3)), bound);
  assert.equal(over.length, 1);
  assert.match(over[0], /deep\.ts:1 deep has a complexity of \d+$/);
});

test('a function at the bound is green — the bound is inclusive', () => {
  assert.deepEqual(overBound(inPackage('at.ts', long(MAX_FUNCTION_LINES)), bound), []);
  assert.deepEqual(overBound(inPackage('at.ts', branched(MAX_COMPLEXITY - 1)), bound), []);
});

test('a short function of many paths is red, and a long one of few is too', () => {
  assert.equal(overBound(inPackage('a.ts', branched(MAX_COMPLEXITY + 1)), bound).length, 1);
  assert.equal(overBound(inPackage('b.ts', long(MAX_FUNCTION_LINES + 1)), bound).length, 1);
});

test('`&&`, `||` and `??` are branches: a guard written as a boolean operator is counted', () => {
  const guards = `export function guarded(a: number, b: number) {\n  return (a && b) || (a ?? b);\n}\n`;
  const [fn] = functionsOf('packages/sdk-core/src/g.ts', guards);
  assert.equal(fn.complexity, 4);
});

test('a nested function is measured inside the one that holds it, never counted twice', () => {
  const nested = `export function outer() {\n  const inner = () => {\n    let n = 0;\n    for (let i = 0; i < 4; i++) n += i;\n    return n;\n  };\n  return inner();\n}\n`;
  const fns = functionsOf('packages/sdk-core/src/n.ts', nested);
  assert.deepEqual(
    fns.map((f) => f.name),
    ['outer'],
  );
  // The closure's branch and its lines are the parent's: it may not hide behind them.
  assert.equal(fns[0].complexity, 2);
  assert.equal(fns[0].lines, 8);
});

test('the gate reads the packages, and leaves the scripts, the site and the bench to their own gates', () => {
  assert.ok(unitOf('packages/sdk-browser/src/gpu/dag/uniforms.ts'));
  assert.equal(unitOf('scripts/check-cohesion.ts'), null);
  assert.equal(unitOf('site/app/main.tsx'), null);
  assert.equal(unitOf('bench/core/index.ts'), null);
});

test('a test, a fixture and a browser probe are never reported', () => {
  assert.ok(isTestModule('packages/sdk-core/src/a.test.ts'));
  assert.ok(isTestModule('packages/sdk-core/src/a.fixture.ts'));
  assert.ok(isTestModule('packages/sdk-core/src/a.perf.ts'));
  assert.ok(isTestModule('packages/sdk-core/src/a.browser.ts'));
  assert.equal(isTestModule('packages/sdk-core/src/a.ts'), false);
  assert.deepEqual(overBound(inPackage('wide.test.ts', long(MAX_FUNCTION_LINES + 5)), bound), []);
});
