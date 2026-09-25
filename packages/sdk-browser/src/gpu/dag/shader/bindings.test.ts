import test from 'node:test';
import assert from 'node:assert/strict';
import { DAG_BINDING, dagBindEntries } from './bindings.ts';
import { DAG_SELECTION_SHADER } from './shader.ts';
import { entryBufferBindings, wgslBufferBindings } from '../../core/wgslBindings.fixture.ts';
import { unresolvedNames } from '../../core/wgslNames.fixture.ts';

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

test('every name the selection shader uses is one it declares, or WGSL its own', () => {
  // A merge that drops a helper still used elsewhere leaves a shader no device compiles.
  assert.deepEqual(unresolvedNames(DAG_SELECTION_SHADER), []);
  const dropped = DAG_SELECTION_SHADER.replace('fn unculledOf(', 'fn unculledOfGone(');
  assert.deepEqual(unresolvedNames(dropped), ['unculledOf']);
});
