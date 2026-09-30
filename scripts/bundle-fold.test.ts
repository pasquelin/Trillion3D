import test from 'node:test';
import assert from 'node:assert/strict';
import { foldDynamicImports } from './bundle-fold.ts';

test('an engine dynamic import folds into its module, a family one stays a chunk', () => {
  const source = [
    'const codec = await import("./geometryPageWasm.js");',
    "loading ??= import('./session.js');",
    'const other = import(variable);',
  ].join('\n');
  const folded = foldDynamicImports(source, (specifier) => specifier === './session.js');
  // Every line keeps its place: the hoisted import is appended, the source map stays true.
  assert.deepEqual(folded.split('\n').slice(0, 3), [
    'const codec = await Promise.resolve(__folded0);',
    "loading ??= import('./session.js');",
    'const other = import(variable);',
  ]);
  assert.match(folded, /\nimport \* as __folded0 from "\.\/geometryPageWasm\.js";\n$/);
});

test('a module without a dynamic import is left as it is', () => {
  const source = 'export const x = 1;\n';
  assert.equal(
    foldDynamicImports(source, () => false),
    source,
  );
});
