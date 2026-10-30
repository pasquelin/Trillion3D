// The corner attributes a hit shades with: the table that closes a file whose head counts corners, three a triangle.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RAY_TRACING_CORNER_BYTES,
  RAY_TRACING_FLAG_ATTRIBUTES,
  RAY_TRACING_HEAD_BYTES,
  RAY_TRACING_ATTRIBUTE_VERSION,
  RAY_TRACING_FLAG_MASKED,
  RAY_TRACING_FLAG_MASK_SET,
  RAY_TRACING_FLAG_MASK_SET_SHIFT,
  RAY_TRACING_MASK_CORNER_BYTES,
  RAY_TRACING_RECORD_AT,
  RAY_TRACING_SECOND_SET_CORNER_BYTES,
  RAY_TRACING_SECOND_SET_VERSION,
} from '../contracts/rayTracingAbi.ts'
import {
  RAY_TRACING_CORNER_WORDS,
  RAY_TRACING_MASK_CORNER_WORDS,
  parseRayTracing,
} from './rayTracingFile.ts'
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

test('a file of the version before the cutout table is read as it is, with no cutout corner', () => {
  const bytes = withCorners(6)
  new DataView(bytes.buffer).setUint32(4, RAY_TRACING_ATTRIBUTE_VERSION, true)
  const read = parseRayTracing(bytes, RAY_TRACING_ATTRIBUTE_VERSION)
  assert.equal(read.corners.length, 6 * RAY_TRACING_CORNER_WORDS)
  assert.equal(read.maskCorners.length, 0)
})

/** The file of two triangles with six corners and `masked` cutout corners closing it, the record naming the mask set `set`. */
function withMask(masked: number, set: number, first = 0) {
  const base = withCorners(6)
  const bytes = new Uint8Array(base.length + masked * RAY_TRACING_MASK_CORNER_BYTES)
  bytes.set(base)
  const view = new DataView(bytes.buffer)
  view.setUint32(28, masked, true)
  const flags = RAY_TRACING_HEAD_BYTES + RAY_TRACING_RECORD_AT.flags * 4
  view.setUint32(
    flags,
    view.getUint32(flags, true) | (set << RAY_TRACING_FLAG_MASK_SET_SHIFT),
    true,
  )
  view.setUint32(RAY_TRACING_HEAD_BYTES + RAY_TRACING_RECORD_AT.maskTriangle * 4, first, true)
  for (let k = 0; k < masked * RAY_TRACING_MASK_CORNER_WORDS; k++)
    view.setUint32(base.length + 4 * k, 100 + k, true)
  return bytes
}

test('the cutout table closes the file, three corners a triangle of the records that name a mask set', () => {
  const read = parseRayTracing(withMask(6, 3))
  assert.equal(read.maskCorners.length, 6 * RAY_TRACING_MASK_CORNER_WORDS)
  assert.deepEqual([...read.maskCorners.slice(0, 4)], [100, 101, 102, 103])
  assert.equal(
    read.records[RAY_TRACING_RECORD_AT.flags]! & RAY_TRACING_FLAG_MASK_SET,
    3 << RAY_TRACING_FLAG_MASK_SET_SHIFT,
  )
})

test('a cutout table that does not match the records, or a set on a record without attributes, is refused', () => {
  assert.throws(() => parseRayTracing(withMask(3, 3)), { code: 'INVALID_CACHE' })
  assert.throws(() => parseRayTracing(withMask(6, 3, 1)), {
    code: 'INVALID_CACHE',
    message: /cutout triangles out of the order/,
  })
  assert.throws(() => parseRayTracing(withMask(6, 0)), { code: 'INVALID_CACHE' })
  const bytes = withMask(6, 3)
  const flags = RAY_TRACING_HEAD_BYTES + RAY_TRACING_RECORD_AT.flags * 4
  const view = new DataView(bytes.buffer)
  view.setUint32(flags, view.getUint32(flags, true) & ~RAY_TRACING_FLAG_ATTRIBUTES, true)
  assert.throws(() => parseRayTracing(bytes), {
    code: 'INVALID_CACHE',
    message: /names a mask set and has no corner attributes/,
  })
})

test('a file of the version with the second set in every corner keeps the attributes and promotes no record to a later mask set: the data cannot say which set its mask reads', () => {
  const base = indexedOf(fileOf())
  const bytes = new Uint8Array(base.length + 6 * RAY_TRACING_SECOND_SET_CORNER_BYTES)
  bytes.set(base)
  const view = new DataView(bytes.buffer)
  view.setUint32(4, RAY_TRACING_SECOND_SET_VERSION, true)
  view.setUint32(24, 6, true)
  const flags = RAY_TRACING_HEAD_BYTES + RAY_TRACING_RECORD_AT.flags * 4
  view.setUint32(
    flags,
    view.getUint32(flags, true) | RAY_TRACING_FLAG_ATTRIBUTES | RAY_TRACING_FLAG_MASKED,
    true,
  )
  for (let k = 0; k < (6 * RAY_TRACING_SECOND_SET_CORNER_BYTES) / 4; k++)
    view.setUint32(base.length + 4 * k, k + 1, true)
  const read = parseRayTracing(bytes, RAY_TRACING_SECOND_SET_VERSION)
  assert.equal(read.corners.length, 6 * RAY_TRACING_CORNER_WORDS)
  assert.deepEqual([...read.corners.slice(0, 4)], [1, 2, 3, 4])
  assert.deepEqual([...read.corners.slice(4, 8)], [7, 8, 9, 10])
  assert.equal(read.maskCorners.length, 0)
  assert.equal(read.records[RAY_TRACING_RECORD_AT.flags]! & RAY_TRACING_FLAG_MASK_SET, 0)
})
