// The captures' records (`records.ts`): the order they are composited in and the block the lighting reads.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveReflectionCapture } from '../../../../sdk-core/src/scene/reflectionCapture/contracts.ts'
import { CAPTURE_BLOCK_WORDS, CAPTURE_HEADER_WORDS, CAPTURE_RECORD_WORDS } from './layout.ts'
import { packReflectionCaptures, reflectionCaptureSorted } from './records.ts'

const R = resolveReflectionCapture

test('the smallest capture is composited first, two of a reach by their name', () => {
  const sorted = reflectionCaptureSorted([
    R({ id: 'big', influenceRadius: 50 }),
    R({ id: 'b', influenceRadius: 5 }),
    R({ id: 'a', influenceRadius: 5 }),
    R({ id: 'box', shape: 'box', matrix: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1] }),
  ])
  assert.deepEqual(
    sorted.map((c) => c.id),
    ['box', 'a', 'b', 'big'],
  )
})

test('the world-to-box matrix of a block undoes a rotation and a scale', () => {
  // The box turned a quarter about the up axis (x -> -z) and scaled by 2, 3 and 4.
  const matrix = [0, 0, -2, 0, 0, 3, 0, 0, 4, 0, 0, 0, 0, 0, 0, 1]
  const out = new Float32Array(CAPTURE_BLOCK_WORDS)
  packReflectionCaptures(out, [R({ id: 'x', shape: 'box', matrix })], new Map(), 4, false)
  const at = CAPTURE_HEADER_WORDS + 12
  const column = (k: number) => [...out.slice(at + 4 * k, at + 4 * k + 3)]
  const apply = (v: number[]) =>
    [0, 1, 2].map((r) => column(0)[r] * v[0] + column(1)[r] * v[1] + column(2)[r] * v[2])
  // The far end of the box's first axis, the matrix's first column, is at 1 in the box's frame.
  assert.deepEqual(
    apply([0, 0, -2]).map((v) => Math.round(v * 1e6) / 1e6),
    [1, 0, 0],
  )
  assert.deepEqual(
    apply([0, 3, 0]).map((v) => Math.round(v * 1e6) / 1e6),
    [0, 1, 0],
  )
  assert.deepEqual(
    apply([4, 0, 0]).map((v) => Math.round(v * 1e6) / 1e6),
    [0, 0, 1],
  )
})

test('the block: the header, then a record each with the layer and the shape', () => {
  const out = new Float32Array(CAPTURE_BLOCK_WORDS)
  const captures = [
    R({
      id: 's',
      influenceRadius: 4,
      brightness: 2,
      captureOffset: [0, 1, 0],
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1],
    }),
    R({
      id: 'x',
      shape: 'box',
      boxTransitionDistance: 0.5,
      matrix: [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1],
    }),
  ]
  packReflectionCaptures(
    out,
    captures,
    new Map([
      ['s', 3],
      ['x', 1],
    ]),
    7,
    true,
  )
  assert.deepEqual([...out.slice(0, 4)], [2, 7, 1, 0])
  const s = CAPTURE_HEADER_WORDS
  assert.deepEqual([...out.slice(s, s + 12)], [5, 6, 7, 4, 2, 3, 0, 1, 0, 1, 0, 0])
  const x = CAPTURE_HEADER_WORDS + CAPTURE_RECORD_WORDS
  assert.deepEqual([...out.slice(x + 4, x + 8)], [1, 1, 1, 1])
  assert.deepEqual([...out.slice(x + 24, x + 28)], [2, 3, 4, 0.5])
  assert.equal(out[x + 12], 0.5)
  assert.throws(
    () => packReflectionCaptures(new Float32Array(8), captures, new Map(), 7, false),
    RangeError,
  )
})
