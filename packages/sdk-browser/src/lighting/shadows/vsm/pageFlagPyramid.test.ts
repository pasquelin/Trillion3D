// The page flag pyramid (`pageManagementWgsl.ts`): a map of one page — a distant light's, its last
// mip alone — records its page in the allocated and uncached rects and builds no hierarchy: the
// cull reads that page at the table's own level (`vsmRectMarks`, `vsmTouchesMappedPixels`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { vsmPageManagementKernels } from './pageManagementWgsl.ts'
import { vsmLayout } from './layout.ts'

const CODE = vsmPageManagementKernels(vsmLayout({ fullMapCapacity: 7 })).pageFlagPyramid.code

test('a one-page map returns after the rects, before the flag and receiver-cover levels', () => {
  const at = (text: string) => {
    const found = CODE.indexOf(text)
    assert.ok(found >= 0, text)
    return found
  }
  const single = at('if(vsmSinglePageMap(projectionData)){return;}')
  // Its page stays in the rects of the cull and of the raster, both layers.
  assert.ok(at('atomicMax(&vsmMappedRects[b+3u]') < single)
  assert.ok(at('atomicMax(&vsmStaleRects[s+3u]') < single)
  // The hierarchical flag levels and the cover pyramid are past it.
  assert.ok(single < at('pmOrMarkAtLevel(flag,tableAt,level+1u)'))
  assert.ok(single < at('vsmReceiverCoverOr(vsmCoverIndex(coverCell,1u)'))
})
