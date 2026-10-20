// Every pass decodes a visibility identifier with `visPageIndex` and `visTriangle`, printed from the
// layout's constants: the shipped WGSL inverts the encode `(row + 1) << VIS_TRIANGLE_BITS | tri`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import {
  VIS_MAX_PAGE_TRIANGLES,
  VIS_TRIANGLE_BITS,
  VIS_TRIANGLE_MASK,
  visPageIndex,
  visTriangle,
} from './visWords.ts'
import { VOXEL_BRICK_TRIANGLES, VOXEL_PAGE_BRICKS } from '../../../sdk-core/src/page/voxelPage.ts'

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

// A voxel page draws its bricks' boxes (`voxelWgsl.ts`): its identifier names every box triangle
// of the bricks the compiler packs in one (`VOXEL_PAGE_BRICKS`, `voxel/page.rs`), and one brick
// more would not fit.
test("a voxel page's box triangles all fit a page's identifier", () => {
  assert.ok(VOXEL_PAGE_BRICKS * VOXEL_BRICK_TRIANGLES <= VIS_MAX_PAGE_TRIANGLES)
  assert.ok((VOXEL_PAGE_BRICKS + 1) * VOXEL_BRICK_TRIANGLES > VIS_MAX_PAGE_TRIANGLES)
})
