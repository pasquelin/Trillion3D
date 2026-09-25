import test from 'node:test';
import assert from 'node:assert/strict';
import { DAG_BINDING, dagBindEntries } from './bindings.ts';
import { DAG_SELECTION_SHADER } from './shader.ts';
import { entryBufferBindings, wgslBufferBindings } from '../../core/wgslBindings.fixture.ts';

test('the DAG layout entries are the bindings the selection shader declares', () => {
  const declared = wgslBufferBindings(DAG_SELECTION_SHADER);
  assert.equal(declared.length, 9);
  assert.deepEqual(entryBufferBindings(dagBindEntries()), declared);
});

test('a binding whose access changes in the shader no longer matches the entries', () => {
  const drifted = DAG_SELECTION_SHADER.replace(
    '@binding(6) var<storage, read> worlds',
    '@binding(6) var<storage, read_write> worlds',
  );
  assert.notEqual(drifted, DAG_SELECTION_SHADER);
  assert.notDeepEqual(entryBufferBindings(dagBindEntries()), wgslBufferBindings(drifted));
});

test('each DAG buffer name owns its own binding, from 0 without a gap', () => {
  const bindings = Object.values(DAG_BINDING).sort((a, b) => a - b);
  assert.deepEqual(bindings, [...bindings.keys()]);
});

/** WGSL's own callables the selection shader uses: types, attributes, keywords and built-ins. */
const WGSL_OWN = new Set(
  (
    'abs asin atomicAdd atomicAnd atomicLoad atomicMax atomicOr atomicStore binding bitcast builtin clamp ' +
    'cross dot f32 floor for group i32 if length log2 mat3x3f mat4x4f max min normalize return ' +
    'round select sin sqrt transpose u32 vec2f vec3f vec4f vec2 vec3 vec4 while workgroupBarrier ' +
    'workgroup_size'
  ).split(' '),
);

/** The names the source calls that it defines nowhere, comments left out. */
function undefinedCalls(source: string) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const defined = new Set([...code.matchAll(/\b(?:fn|struct)\s+(\w+)/g)].map((m) => m[1]));
  const called = [...code.matchAll(/(?<![\w.])([A-Za-z_]\w*)\s*(?:<[^>()]*>)?\s*\(/g)];
  return [...new Set(called.map((m) => m[1]))].filter((n) => !defined.has(n) && !WGSL_OWN.has(n));
}

test('every function the selection shader calls is one it defines, or WGSL its own', () => {
  // A merge that drops a helper still used elsewhere leaves a shader no device compiles.
  assert.deepEqual(undefinedCalls(DAG_SELECTION_SHADER), []);
  const dropped = DAG_SELECTION_SHADER.replace('fn unculledOf(', 'fn unculledOfGone(');
  assert.deepEqual(undefinedCalls(dropped), ['unculledOf']);
});
