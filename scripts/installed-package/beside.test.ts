import test from 'node:test'
import assert from 'node:assert/strict'
import { missingBeside } from './beside.ts'

// The decoder's chunk also holds the animation sampler, which starts its worker beside itself.
const decoder = {
  path: 'chunk-A.js',
  text: 'new URL("./pageCodec.wasm", import.meta.url);besideModule("animationWorker",import.meta.url)',
}
const physics = { path: 'session-B.js', text: '"./joltPhysics.wasm"' }
const physicsFiles = ['physicsWorker.js', 'joltPhysics.wasm', 'joltPhysicsThreads.wasm']

test('a chunk at the bundle root finds the decoder module beside it (#568)', () => {
  // The chunks sit beside the entries since #397: the module lands at the root, no folder.
  assert.deepEqual(
    missingBeside(
      [decoder, physics],
      ['chunk-A.js', 'pageCodec.wasm', 'animationWorker.js', ...physicsFiles],
    ),
    [],
  )
})

test('a module missing beside its chunk, or in another folder, is named', () => {
  assert.deepEqual(
    missingBeside(
      [decoder, physics],
      ['chunks/pageCodec.wasm', 'animationWorker.js', ...physicsFiles],
    ),
    ['chunk-A.js does not find pageCodec.wasm beside it'],
  )
  const nested = { ...decoder, path: 'chunks/chunk-A.js' }
  assert.deepEqual(
    missingBeside(
      [nested, physics],
      ['chunks/pageCodec.wasm', 'chunks/animationWorker.js', ...physicsFiles],
    ),
    [],
  )
})

test('a bundle with no chunk that loads a module says so', () => {
  assert.deepEqual(missingBeside([physics], physicsFiles), [
    'no chunk names pageCodec.wasm',
    'no chunk names animationWorker',
  ])
})
