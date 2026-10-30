// An image with no scene trace names the lights as traced only where the volume was traced for these words.

import test from 'node:test'
import assert from 'node:assert/strict'
import { tracedFor } from './gpu.ts'

const history = (volume: unknown, words: number[], owners = ['a', 'b']) =>
  ({ traced: { volume, words: Uint32Array.from(words), owners } }) as unknown as Parameters<
    typeof tracedFor
  >[0]

test('the lights are named only against the allocation and the words the last trace wrote', () => {
  const volume = {}
  const held = history(volume, [5, 2])
  assert.equal(tracedFor(held, volume, Uint32Array.of(5, 2, 9), 2, ['a', 'b']), true)
  assert.equal(
    tracedFor(held, {}, Uint32Array.of(5, 2), 2, ['a', 'b']),
    false,
    'another allocation',
  )
  assert.equal(tracedFor(held, volume, Uint32Array.of(5, 3), 2, ['a', 'b']), false, 'other lights')
  assert.equal(tracedFor(held, volume, Uint32Array.of(5, 2, 1), 3, ['a', 'b']), false, 'more words')
  assert.equal(
    tracedFor(held, volume, Uint32Array.of(5, 2), 2, ['a', 'c']),
    false,
    'another light in the same rank',
  )
  assert.equal(
    tracedFor({ traced: undefined } as never, volume, Uint32Array.of(5), 1, ['a']),
    false,
  )
})
