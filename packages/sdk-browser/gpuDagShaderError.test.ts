// WGSL mirror of the EXPERIMENT variant: the shipped text carries ours, the external-reference
// campaign returns only a constant, and the shader branch restates `referenceScreenError` from
// sdk-core word for word.
import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceScreenError } from '../sdk-core/src/index.ts';
import { DAG_SELECTION_SHADER } from './gpuDagShader.ts';
import { REFERENCE_ERROR_DECL, withScreenErrorVariant } from './gpuDagShaderError.ts';

test('the default text is returned character for character, the constant being false', () => {
  assert.ok(DAG_SELECTION_SHADER.includes(REFERENCE_ERROR_DECL));
  assert.equal(withScreenErrorVariant(DAG_SELECTION_SHADER, 'certifiee'), DAG_SELECTION_SHADER);
  // The certified bound is still there, operands and order unchanged.
  assert.match(DAG_SELECTION_SHADER, /return \(\(shift\*focal\)\/nearest\)\*\(slant\/closest\);/);
});

test('the reference variant returns only the constant, and carries the same formula as the CPU', () => {
  const code = withScreenErrorVariant(DAG_SELECTION_SHADER, 'reference');
  assert.equal(code.split('const REFERENCE_ERROR:bool=true;').length, 2);
  assert.ok(!code.includes(REFERENCE_ERROR_DECL));
  assert.equal(
    code.replace('const REFERENCE_ERROR:bool=true;', REFERENCE_ERROR_DECL),
    DAG_SELECTION_SHADER,
  );
  // Shader branch, copied: same operands, same order as `referenceScreenError`.
  assert.match(
    code,
    /let depth=p\*-v\.z\+flat;\n {2}if\(!\(depth>p\*uni\.near\)\)\{return INF;\}\n {2}let delta=error\*stretch;\n {2}return \(delta\*focal\)\/depth;/,
  );
  for (const [error, stretch, depth, focal, near] of [
    [0.05, 1, 10, 600, 0.1],
    [0.5, 0.02, 12, 900, 0.1],
    [7, 1.5, 0.05, 512, 0.1],
  ] as const) {
    const delta = error * stretch;
    const noyau = !(depth > near) ? Infinity : (delta * focal) / depth;
    assert.equal(noyau, referenceScreenError(error, stretch, depth, focal, near));
  }
});

test('a text without the declaration is refused rather than returned unchanged', () => {
  assert.throws(
    () => withScreenErrorVariant('fn projected(){}', 'reference'),
    /REFERENCE_ERROR declaration missing/,
  );
});
