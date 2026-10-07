// A blend item names its surface's anisotropic and clear-coat record (word 51, `physical`), in the
// opaque rows' table, its high bit set where the floats it reads carry a second UV set — its own
// normal atlas's tail, or the float pool's block —; a surface without a lobe names none: the word
// is what `refreshBlendScene` reads an item's `lobed` off, which every lobe switch derives from.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { surfaceOf } from '../../page/surface.ts'
import { BLEND_ITEM_WORDS, writeBlendItemRecord } from './items.ts'
import { refreshBlendScene } from './resources.ts'
import { createPhysicalTable } from '../visibility/physicalTable.ts'
import { PHYSICAL_SECOND_UV } from '../../visibility/buffer.ts'
import type { BlendGpuItem } from './state.ts'
import { emptyGeometryBlock } from '../row/pageRowMaterial.ts'

/** The physical word an item of `surface` writes, and what it returns. */
function wordOf(surface: G.GraphSurface, item: Partial<BlendGpuItem> = {}, hasUv1 = false) {
  const floats = new Float32Array(BLEND_ITEM_WORDS),
    ints = new Uint32Array(floats.buffer)
  const geometry = new G.Geometry()
  const record = {
    surface: surfaceOf(surface),
    matrix: new G.Matrix4(),
    flags: 1,
    count: 3,
    sourceGeometry: geometry,
    ...item,
  } as BlendGpuItem
  const returned = writeBlendItemRecord(floats, ints, 0, record, {
    mapLayer: new Map(),
    dataLayer: new Map(),
    physicalTable: createPhysicalTable(),
    geometryBlocks: new Map([[geometry.attributes, { ...emptyGeometryBlock(), count: 3, hasUv1 }]]),
  })
  assert.equal(returned, ints[51])
  return { word: ints[51], item: record }
}

test('a lobed blend names its record, a second UV set in its high bit; a plain one names none', () => {
  const coat = () => G.physicalSurface({ clearcoat: 1, transparent: true, opacity: 0.5 })
  assert.equal(wordOf(coat()).word, 1)
  // Its own atlas's tail, or the pool's block, says so.
  assert.equal(wordOf(coat(), { ownUv1: true }).word, (1 | PHYSICAL_SECOND_UV) >>> 0)
  assert.equal(wordOf(coat(), {}, true).word, (1 | PHYSICAL_SECOND_UV) >>> 0)
  assert.equal(wordOf(coat(), { ownUv1: false }, true).word, 1)
  const plain = wordOf(G.physicalSurface({ transparent: true, opacity: 0.5 }))
  assert.equal(plain.word, 0)
})

test('the last item gone, no lobe stays picked', () => {
  const blendState = { blendGpu: [], lobed: true, waterLobed: true }
  refreshBlendScene({ blendState, vis: {} } as never, {} as GPUDevice)
  assert.deepEqual([blendState.lobed, blendState.waterLobed], [false, false])
})
