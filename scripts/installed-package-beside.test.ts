import test from 'node:test';
import assert from 'node:assert/strict';
import { missingBeside } from './installed-package-beside.ts';

const decoder = { path: 'chunk-A.js', text: 'new URL("./pageCodec.wasm", import.meta.url)' };
const physics = { path: 'session-B.js', text: '"./joltPhysics.wasm"' };
const physicsFiles = ['physicsWorker.js', 'joltPhysics.wasm', 'joltPhysicsThreads.wasm'];

test('a chunk at the bundle root finds the decoder module beside it (#568)', () => {
  // The chunks sit beside the entries since #397: the module lands at the root, no folder.
  assert.deepEqual(
    missingBeside([decoder, physics], ['chunk-A.js', 'pageCodec.wasm', ...physicsFiles]),
    [],
  );
});

test('a module missing beside its chunk, or in another folder, is named', () => {
  assert.deepEqual(missingBeside([decoder, physics], ['chunks/pageCodec.wasm', ...physicsFiles]), [
    'chunk-A.js does not find pageCodec.wasm beside it',
  ]);
  const nested = { ...decoder, path: 'chunks/chunk-A.js' };
  assert.deepEqual(
    missingBeside([nested, physics], ['chunks/pageCodec.wasm', ...physicsFiles]),
    [],
  );
});

test('a bundle with no chunk that loads a module says so', () => {
  assert.deepEqual(missingBeside([physics], physicsFiles), ['no chunk names pageCodec.wasm']);
});
