// A blend item names its surface's record (`material`), in the opaque rows' table, its high bit set
// where the floats it reads carry a second UV set — the float pool's block says so —; what it
// returns says whether its surface carries a lobe, which `refreshBlendScene` reads an item's `lobed`
// off, which every lobe switch derives from, and whether it gives up some of its history.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../scene/host/graph/graph.fixture.ts'
import { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts'
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'
import { surfaceOf, type PageSurface } from '../geometry/pages/surface.ts'
import {
  BLEND_ITEM_WORDS,
  ITEM_FLAG_BITS,
  ITEM_FLAGS_WORD,
  ITEM_HISTORY_SHIFT,
  ITEM_NEEDS,
  writeBlendItemRecord,
} from './items.ts'
import { refreshBlendScene } from './sceneRefresh.ts'
import { createMaterialTable } from '../materials/table/materialTable.ts'
import { HISTORY_SHARE_MASK, MATERIAL_SECOND_UV } from '../visibility/types.ts'
import type { BlendGpuItem } from './state.ts'
import { emptyGeometryBlock } from '../geometry/rows/page/pageRowMaterial.ts'

/** The material word an item of `surface` writes, and what it returns. */
function wordOf(surface: PageSurface, item: Partial<BlendGpuItem> = {}, hasUv1 = false) {
  const floats = new Float32Array(BLEND_ITEM_WORDS),
    ints = new Uint32Array(floats.buffer)
  const geometry = new Geometry()
  const record = {
    surface: surfaceOf(surface),
    matrix: new Matrix4(),
    flags: 1,
    sourceGeometry: geometry,
    ...item,
  } as BlendGpuItem
  const returned = writeBlendItemRecord(floats, ints, 0, record, {
    mapLayer: new Map(),
    dataLayer: new Map(),
    materialTable: createMaterialTable(),
    geometryBlocks: new Map([[geometry.attributes, { ...emptyGeometryBlock(), count: 3, hasUv1 }]]),
  })
  // The record's material word: its twentieth (`itemRecord.test.ts`).
  return {
    word: ints[19],
    flags: ints[ITEM_FLAGS_WORD],
    lobed: (returned & ITEM_NEEDS.lobed) !== 0,
    givesUp: (returned & ITEM_NEEDS.givesUp) !== 0,
    item: record,
  }
}

test('a blend names its record, a second UV set in its high bit, and says whether it is lobed', () => {
  const coat = () => G.physicalSurface({ clearcoat: 1, transparent: true, opacity: 0.5 })
  assert.deepEqual([wordOf(coat()).word, wordOf(coat()).lobed], [0, true])
  // The pool's block says so.
  assert.equal(wordOf(coat(), {}, true).word, MATERIAL_SECOND_UV)
  const plain = wordOf(G.physicalSurface({ transparent: true, opacity: 0.5 }))
  assert.deepEqual([plain.word, plain.lobed], [0, false])
})

test('a blend carries its surface history share code in its own bits, out of the view flags', () => {
  const recordOf = (temporalAntialiasing?: number) =>
    wordOf(G.physicalSurface({ transparent: true, opacity: 0.5, temporalAntialiasing }))
  const codeOf = (temporalAntialiasing?: number) =>
    (recordOf(temporalAntialiasing).flags >>> ITEM_HISTORY_SHIFT) & HISTORY_SHARE_MASK
  // In twelfths of the history given up: 1 none, 0.75 three, 0 all twelve.
  assert.deepEqual([codeOf(), codeOf(1), codeOf(0.75), codeOf(0.5), codeOf(0)], [0, 0, 3, 6, 12])
  // A surface that gives some up says so: its scene's blends then write the history given up.
  assert.deepEqual(
    [recordOf().givesUp, recordOf(1).givesUp, recordOf(0.75).givesUp, recordOf(0).givesUp],
    [false, false, true, true],
  )
  // Above the low sixteen bits the vertex stage ORs the view's flags with.
  assert.equal((15 << ITEM_HISTORY_SHIFT) & ITEM_FLAG_BITS, 0)
})

test('the last item gone, no lobe stays picked and no history is given up', () => {
  const blendState = { blendGpu: [], lobed: true, givesUp: true }
  refreshBlendScene({ blendState, vis: {} } as never, {} as GPUDevice)
  assert.equal(blendState.lobed, false)
  assert.equal(blendState.givesUp, false)
})
