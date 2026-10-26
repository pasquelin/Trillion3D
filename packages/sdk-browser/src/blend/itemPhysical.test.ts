// A blend item names its surface's record (`material`), in the opaque rows' table, its high bit set
// where the floats it reads carry a second UV set — the float pool's block says so —; what it
// returns says whether its surface carries a lobe, which `refreshBlendScene` reads an item's `lobed`
// off, which every lobe switch derives from, and whether it carries a responsiveness.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../scene/host/graph/graph.fixture.ts'
import { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts'
import type { ResponsiveLevel } from '../../../sdk-core/src/contracts/materialAbi.ts'
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'
import { surfaceOf, type PageSurface } from '../geometry/pages/surface.ts'
import {
  BLEND_ITEM_WORDS,
  ITEM_FLAG_BITS,
  ITEM_FLAGS_WORD,
  ITEM_RESPONSIVE_SHIFT,
  ITEM_NEEDS,
  writeBlendItemRecord,
} from './items.ts'
import { refreshBlendScene } from './sceneRefresh.ts'
import { createMaterialTable } from '../materials/table/materialTable.ts'
import { MATERIAL_SECOND_UV, RESPONSIVE_MASK } from '../visibility/types.ts'
import type { BlendGpuItem } from './state.ts'
import { emptyGeometryBlock } from '../geometry/rows/page/pageRowMaterial.ts'

/** The material word an item of `surface` writes, and what it returns. */
function wordOf(surface: PageSurface, item: Partial<BlendGpuItem> = {}, hasExtraUv = false) {
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
    geometryBlocks: new Map([
      [geometry.attributes, { ...emptyGeometryBlock(), count: 3, hasExtraUv }],
    ]),
  })
  // The record's material word: its twentieth (`itemRecord.test.ts`).
  return {
    word: ints[19],
    flags: ints[ITEM_FLAGS_WORD],
    lobed: (returned & ITEM_NEEDS.lobed) !== 0,
    responsive: (returned & ITEM_NEEDS.responsive) !== 0,
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

test('a blend carries its surface responsiveness code in its own bits, out of the view flags', () => {
  const recordOf = (responsive?: ResponsiveLevel) =>
    wordOf(
      G.physicalSurface({
        transparent: true,
        opacity: 0.5,
        responsive,
        translucencyPass: 'beforeDepthOfField',
      }),
    )
  const codeOf = (responsive?: ResponsiveLevel) =>
    (recordOf(responsive).flags >>> ITEM_RESPONSIVE_SHIFT) & RESPONSIVE_MASK
  // None, a pixel animation, a pixel animation whose history restarts.
  assert.deepEqual([codeOf(), codeOf('off'), codeOf('medium'), codeOf('full')], [0, 0, 1, 3])
  // A surface that carries some says so: its scene's blends then write the responsive target.
  assert.deepEqual(
    [
      recordOf().responsive,
      recordOf('off').responsive,
      recordOf('medium').responsive,
      recordOf('full').responsive,
    ],
    [false, false, true, true],
  )
  // Above the low sixteen bits the vertex stage ORs the view's flags with.
  assert.equal((RESPONSIVE_MASK << ITEM_RESPONSIVE_SHIFT) & ITEM_FLAG_BITS, 0)
})

test('only the layers of the pass before the depth of field, in a blend that adds to or filters the scene, mark', () => {
  const marks = (extra: object) =>
    wordOf(G.physicalSurface({ transparent: true, opacity: 0.5, responsive: 'full', ...extra }))
      .responsive
  const before = { translucencyPass: 'beforeDepthOfField' }
  assert.equal(marks(before), true)
  assert.equal(marks({ ...before, blending: 'additive' }), true)
  assert.equal(marks({ ...before, blending: 'multiply' }), true)
  assert.equal(marks({ ...before, blending: 'alphaComposite' }), false)
  assert.equal(marks({ ...before, blending: 'alphaHoldout' }), false)
  assert.equal(
    marks({ translucencyPass: 'afterDepthOfField' }),
    false,
    'the default pass marks none',
  )
  assert.equal(marks({ translucencyPass: 'afterMotionBlur' }), false)
})

test('the last item gone, no lobe stays picked and no responsiveness is carried', () => {
  const blendState = { blendGpu: [], lobed: true, responsive: true }
  refreshBlendScene({ blendState, vis: {} } as never, {} as GPUDevice)
  assert.equal(blendState.lobed, false)
  assert.equal(blendState.responsive, false)
})
