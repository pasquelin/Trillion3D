// A blend item names its surface's record (`material`), in the opaque rows' table, its high bit set
// where the floats it reads carry a second UV set — its own normal atlas's tail, or the float pool's
// block —; what it returns is whether its surface carries a lobe, which `refreshBlendScene` reads an
// item's `lobed` off, which every lobe switch derives from.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { surfaceOf, type PageSurface } from '../../page/surface.ts'
import { BLEND_ITEM_WORDS, writeBlendItemRecord } from './items.ts'
import { refreshBlendScene } from './sceneRefresh.ts'
import { createMaterialTable } from '../material/materialTable.ts'
import { MATERIAL_SECOND_UV } from '../../visibility/types.ts'
import type { BlendGpuItem } from './state.ts'
import { emptyGeometryBlock } from '../row/pageRowMaterial.ts'

/** The material word an item of `surface` writes, and what it returns. */
function wordOf(surface: PageSurface, item: Partial<BlendGpuItem> = {}, hasUv1 = false) {
  const floats = new Float32Array(BLEND_ITEM_WORDS),
    ints = new Uint32Array(floats.buffer)
  const geometry = new Geometry()
  const record = {
    surface: surfaceOf(surface),
    matrix: new Matrix4(),
    flags: 1,
    count: 3,
    sourceGeometry: geometry,
    ...item,
  } as BlendGpuItem
  const returned = writeBlendItemRecord(floats, ints, 0, record, {
    mapLayer: new Map(),
    dataLayer: new Map(),
    materialTable: createMaterialTable(),
    geometryBlocks: new Map([[geometry.attributes, { ...emptyGeometryBlock(), count: 3, hasUv1 }]]),
  })
  // The record's material word: its twenty-third (`itemRecord.test.ts`).
  return { word: ints[22], lobed: returned, item: record }
}

test('a blend names its record, a second UV set in its high bit, and says whether it is lobed', () => {
  const coat = () => G.physicalSurface({ clearcoat: 1, transparent: true, opacity: 0.5 })
  assert.deepEqual([wordOf(coat()).word, wordOf(coat()).lobed], [0, true])
  // Its own atlas's tail, or the pool's block, says so.
  assert.equal(wordOf(coat(), { ownUv1: true }).word, MATERIAL_SECOND_UV)
  assert.equal(wordOf(coat(), {}, true).word, MATERIAL_SECOND_UV)
  assert.equal(wordOf(coat(), { ownUv1: false }, true).word, 0)
  const plain = wordOf(G.physicalSurface({ transparent: true, opacity: 0.5 }))
  assert.deepEqual([plain.word, plain.lobed], [0, false])
})

test('the last item gone, no lobe stays picked', () => {
  const blendState = { blendGpu: [], lobed: true, waterLobed: true }
  refreshBlendScene({ blendState, vis: {} } as never, {} as GPUDevice)
  assert.deepEqual([blendState.lobed, blendState.waterLobed], [false, false])
})
