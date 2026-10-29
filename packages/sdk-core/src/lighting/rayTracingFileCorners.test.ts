// The corner attributes a hit shades with: the table that closes a file whose head counts corners, three a triangle.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RAY_TRACING_CORNER_BYTES,
  RAY_TRACING_FLAG_ATTRIBUTES,
  RAY_TRACING_HEAD_BYTES,
  RAY_TRACING_RECORD_AT,
} from '../contracts/rayTracingAbi.ts'
import { RAY_TRACING_CORNER_WORDS, parseRayTracing } from './rayTracingFile.ts'
import { fileOf, indexedOf } from './rayTracingFile.fixture.ts'

/** The indexed file of two triangles closed by a table of `corners` corners, the head naming their count, the record flagged. */
function withCorners(corners: number, flagged = true) {
  const base = indexedOf(fileOf())
  const bytes = new Uint8Array(base.length + corners * RAY_TRACING_CORNER_BYTES)
  bytes.set(base)
  const view = new DataView(bytes.buffer)
  view.setUint32(24, corners, true)
  const flags = RAY_TRACING_HEAD_BYTES + RAY_TRACING_RECORD_AT.flags * 4
  if (flagged)
    view.setUint32(flags, view.getUint32(flags, true) | RAY_TRACING_FLAG_ATTRIBUTES, true)
  for (let k = 0; k < corners * RAY_TRACING_CORNER_WORDS; k++)
    view.setUint32(base.length + 4 * k, k + 1, true)
  return bytes
}

test('the corner table is read word for word, three corners a triangle', () => {
  const read = parseRayTracing(withCorners(6))
  assert.equal(read.corners.length, 6 * RAY_TRACING_CORNER_WORDS)
  assert.deepEqual([...read.corners.slice(0, 4)], [1, 2, 3, 4])
  assert.equal(parseRayTracing(indexedOf(fileOf())).corners.length, 0)
})

test('a table that is not three corners a triangle, or a file of another size, is refused', () => {
  assert.throws(() => parseRayTracing(withCorners(5)), {
    code: 'INVALID_CACHE',
    message: /5 corners for 2 triangles/,
  })
  const short = withCorners(6).slice(0, -4)
  assert.throws(() => parseRayTracing(short), { code: 'INVALID_CACHE' })
})
