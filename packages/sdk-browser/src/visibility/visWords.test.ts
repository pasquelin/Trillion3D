// Every pass decodes a visibility identifier with `visPageIndex` and `visTriangle`, printed from the
// layout's constants: the shipped WGSL inverts the encode `(row + 1) << VIS_TRIANGLE_BITS | tri`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { VIS_TRIANGLE_BITS, VIS_TRIANGLE_MASK, visPageIndex, visTriangle } from './visWords.ts'

type Decode = (id: number) => number

test('the WGSL decode returns the row and the triangle an identifier was encoded with', () => {
  const { visPageIndex: row } = shaderRun<{ visPageIndex: Decode }>(
    visPageIndex,
    ['visPageIndex'],
    {},
  )
  const { visTriangle: tri } = shaderRun<{ visTriangle: Decode }>(visTriangle, ['visTriangle'], {})
  for (const [page, triangle] of [
    [0, 0],
    [3, 17],
    [65_535, VIS_TRIANGLE_MASK],
    [1_000_000, 128],
  ]) {
    const id = (((page + 1) << VIS_TRIANGLE_BITS) | triangle) >>> 0
    assert.equal(row(id) >>> 0, page)
    assert.equal(tri(id) >>> 0, triangle)
  }
})
