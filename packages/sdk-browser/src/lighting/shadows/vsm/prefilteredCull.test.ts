// What the prefiltered distant shadow's programs do (`renderCullWgsl.ts`, `boxCullWgsl.ts`,
// `markingWgsl.ts`): a page matches a caster's mask by its request bits too, a caster of a level is cut
// by the level's band and asks the primary request where it lies wholly inside it, the cull's emit
// takes the pages that match, and a page marked from the view carries the primary request.
import test from 'node:test'
import assert from 'node:assert/strict'
import { FLOAT32_MAX } from '../../../../../math/src/constants.ts'
import { f32Bits } from '../../../../../math/src/float/bits.ts'
import { wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../../materials/texture/shaderRunMatrix.fixture.ts'
import { vsmPixelPageMarkingWgsl } from './markingWgsl.ts'
import type { VsmLayout } from './layout.ts'
import { OFF, ON } from './prefiltered.fixture.ts'
import { VSM_MAP_PREFILTERED_DISTANT } from './prefilteredConstants.ts'
import { vsmRenderCullWgsl } from './render/renderCullWgsl.ts'
import { VSM_RENDER_COUNT_WORDS } from './render/renderParamsWgsl.ts'

const [CULL_OFF, CULL_ON] = [vsmRenderCullWgsl(OFF), vsmRenderCullWgsl(ON)]
const C = wgslConstants(CULL_ON)
const { VSM_PAGE_WANTED: W, VSM_PAGE_DYNAMIC_STALE: DYNAMIC, VSM_PAGE_FINE: FINE } = C
const { VSM_PAGE_PRIMARY: PRIMARY, VSM_PAGE_SECONDARY: SECONDARY } = C

const matcher = (code: string) =>
  shaderRun<{ vsmMarksMatch(marks: number, mask: number): boolean }>(code, ['vsmMarksMatch'], {})
    .vsmMarksMatch

test('a page matches a mask by one of its stale bits and all its request bits, with the feature', () => {
  const match = matcher(CULL_ON)
  assert.equal(match(W | DYNAMIC | PRIMARY, DYNAMIC | PRIMARY), true)
  assert.equal(match(W | DYNAMIC, DYNAMIC | PRIMARY), false, 'not asked by the view')
  assert.equal(match(W | PRIMARY, DYNAMIC | PRIMARY), false, 'asked, but nothing to draw')
  assert.equal(match(W | DYNAMIC | FINE, DYNAMIC | FINE), true)
  assert.equal(match(W | DYNAMIC, DYNAMIC | FINE), false, 'a fine caster wants a fine page')
  assert.equal(match(W | DYNAMIC | SECONDARY, DYNAMIC | SECONDARY), true)
  assert.equal(match(W | DYNAMIC | PRIMARY, DYNAMIC | SECONDARY), false)
  // A mask that asks none of them reads the stale bits alone, as without the feature.
  assert.equal(match(W | DYNAMIC | PRIMARY | SECONDARY, DYNAMIC), true)
  assert.equal(match(W | PRIMARY, DYNAMIC), false)
})

test('without the feature a page matches by one bit of the mask and the fine bit alone', () => {
  const match = matcher(CULL_OFF)
  assert.equal(match(W | DYNAMIC, DYNAMIC | PRIMARY), true, 'the request bits are not asked')
  assert.equal(match(W | DYNAMIC, DYNAMIC | FINE), false)
  assert.equal(match(W | DYNAMIC | FINE, DYNAMIC | FINE), true)
})

/** A level of a prefiltered clipmap, or not, with its band in clip depth. */
const level = (prefiltered: boolean) => ({
  flags: prefiltered ? VSM_MAP_PREFILTERED_DISTANT : 0,
  dynamicDepthCullRange: [0.4, 0.6],
})
const boxAt = (low: number, high: number) => ({ clipLow: [0, 0, low], clipHigh: [0, 0, high] })

test('in a level of the feature every caster is cut by the band’s outer end, and one inside its inner end asks the primary request', () => {
  const layer = shaderRun<{
    vsmCasterInDepthRange(l: object, cull: object, pd: object): boolean
    vsmCasterMarkMask(l: object, cull: object, pd: object): number
  }>(CULL_ON, ['vsmCasterInDepthRange', 'vsmCasterMarkMask'], {})
  const [still, moving] = [
    { staticLayer: true, markMask: DYNAMIC },
    { staticLayer: false, markMask: DYNAMIC },
  ]
  const band = level(true)
  // The box reaching in front of the outer end (clip depth 0.6) is drawn, the static layer's too.
  for (const l of [still, moving]) {
    assert.equal(layer.vsmCasterInDepthRange(l, boxAt(0.5, 0.9), band), true)
    assert.equal(layer.vsmCasterInDepthRange(l, boxAt(0.7, 0.9), band), false, 'past the outer end')
  }
  // Wholly inside the inner end (clip depth 0.4): the primary request of its pages, else the layer's.
  assert.equal(layer.vsmCasterMarkMask(moving, boxAt(0.1, 0.3), band), DYNAMIC | PRIMARY)
  assert.equal(
    layer.vsmCasterMarkMask(moving, boxAt(0.1, 0.4), band),
    DYNAMIC,
    'it reaches the end',
  )
  assert.equal(layer.vsmCasterMarkMask(moving, boxAt(0.5, 0.9), band), DYNAMIC)
  // Any other map is cut as it was: the dynamic layer by the range, the static one not at all, and
  // no request bit is asked.
  const plain = level(false)
  assert.equal(layer.vsmCasterInDepthRange(moving, boxAt(0.5, 0.9), plain), true)
  assert.equal(layer.vsmCasterInDepthRange(moving, boxAt(0.7, 0.9), plain), false)
  assert.equal(layer.vsmCasterInDepthRange(still, boxAt(0.7, 0.9), plain), true)
  assert.equal(layer.vsmCasterMarkMask(moving, boxAt(0.1, 0.3), plain), DYNAMIC)
})

/** The cull's emit over the pages of a rect of three, `marks` the marks of each, a window of one
 *  page: the records it takes. */
function recordsOf(code: string, marks: number[], mask: number) {
  const room = 8,
    counts = new Array(VSM_RENDER_COUNT_WORDS + 16).fill(0)
  const emit = shaderRun<{ vsmRenderEmit(...a: unknown[]): void }>(code, ['vsmRenderEmit'], {
    ...wgslConstants(code),
    counts,
    records: Array.from({ length: room }, () => [-1, -1, -1, -1]),
    params: { recordCapacity: room },
    vsmTableLevelOrigin: () => ({}),
    vsmTableEntryAt: (_origin: unknown, _mip: number, page: number[]) => page,
    vsmPageMarkWord: (page: number[]) => marks[page[0]],
  })
  emit.vsmRenderEmit(9, 0, 0, { id: 3 }, 0, [0, 0, 2, 0], mask, 1)
  return counts[wgslConstants(code).VSM_RENDER_COUNT_RECORDS]
}

test('the emit takes the pages that match the mask, the request bits too', () => {
  const marks = [W | DYNAMIC | PRIMARY, W | DYNAMIC, W | DYNAMIC | PRIMARY | FINE]
  assert.equal(recordsOf(CULL_ON, marks, DYNAMIC | PRIMARY), 2, 'the pages the view asked')
  assert.equal(recordsOf(CULL_OFF, marks, DYNAMIC), 3, 'without it, every page with a stale layer')
  assert.equal(recordsOf(CULL_ON, marks, DYNAMIC), 3, 'a mask that asks none of the bits')
})

/** The flags `vsmMarkPage` requests a page with, from a point inside the map. */
function pageFlags(layout: VsmLayout) {
  const requested: number[] = []
  const identity = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const map = {
    ...{ originShiftHigh: [0, 0, 0], originShiftLow: [0, 0, 0] },
    ...{ shiftedToMapUv: identity, useCover: false },
  }
  const mark = shaderRun<{ vsmMarkPage(...a: unknown[]): void }>(
    vsmPixelPageMarkingWgsl(layout),
    ['vsmMarkPage'],
    {
      vsmMarking: { originShiftHigh: [0, 0, 0], originShiftLow: [0, 0, 0] },
      vsmProjectionOf: () => map,
      vsmTableEntryOf: () => ({ tableXY: [0, 0] }),
      vsmRequestPage: (_cell: unknown, flags: number) => requested.push(flags),
    },
  )
  mark.vsmMarkPage({ id: 1 }, 0, [0.5, 0.5, 0.5], false, [0, 0], true)
  return requested
}

test('a page marked from the view is wanted and fine, and with the feature primary', () => {
  assert.deepEqual(pageFlags(OFF), [W | FINE])
  assert.deepEqual(pageFlags(ON), [W | FINE | PRIMARY])
})

/** `vsmRenderCullViews` over one caster of the map `pd`, the box cull standing in: the masks it asks
 *  of the pages, and the mask the occlusion's second cull is given. */
function viewMasks(pd: object, box: { clipLow: number[]; clipHigh: number[] }) {
  const identity = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const map = {
    ...{ uncached: true, useCover: false, finestMip: 0, viewSlot: 0, wpoThreshold: 0 },
    lightKind: C.LIGHT_KIND_DIRECTIONAL! + 1,
    ...{ lightViewToClip: identity, shiftedToMapUv: identity, ...pd },
    ...{ originShiftHigh: [0, 0, 0], originShiftLow: [0, 0, 0] },
  }
  const view = { ...box, inMapView: true, pastNear: false, pastFar: false }
  const asked: number[] = [],
    emitted: number[] = [],
    hidden: number[] = []
  const run = shaderRun<{ vsmRenderCullViews(...a: unknown[]): void }>(
    CULL_ON,
    ['vsmRenderCullViews'],
    {
      ...C,
      params: {},
      vsm: { lodDeltaInvalidates: 0 },
      views: [[7, 0, 3, f32Bits(1)]],
      vsmHandleFromId: (id: number) => ({ id }),
      vsmProjectionOf: () => map,
      vsmShiftedToClip: (m: Mat) => m,
      vsmBoxCullPoint: () => [0, 0, 0],
      vsmBoxInView: () => view,
      vsmCasterBoxInView: () => view,
      vsmClipRadius: () => 1,
      vsmIsFineCaster: () => false,
      vsmRenderEdgeScale: () => 1,
      vsmRenderLodAt: () => C.VSM_RENDER_LOD_OWN,
      vsmRectPixels: () => [0, 0, 16, 16],
      vsmClipToStaleRect: (pixels: number[]) => pixels,
      vsmTouchesMappedPixels: (...a: unknown[]) => (asked.push(a[3] as number), true),
      vsmRenderSwapped: () => false,
      vsmRenderTierOf: () => 0,
      vsmRenderSoftware: () => false,
      vsmHiddenBefore: () => false,
      vsmHiddenNow: (...a: unknown[]) => (hidden.push(a[5] as number), false),
      vsmRenderEmit: (...a: unknown[]) => emitted.push(a[6] as number),
    },
  )
  const caster = {
    ...{ c: [10, 0, 0, 1], l: [0, 0, 0], row: 3, corners: 3, flags: 0, farDepth: 0 },
    ...{ own: [0, 0, 0, 1], parent: [0, 0, 0, 1], errors: [0, 0], edge: 0 },
    ...{ inst: [0, 0, 0, 1], viewBits: 0, offsetDisableSq: 0, prevShift: [0, 0, 0] },
    ...{ tail0: [1, 1, 1, 1], tail1: [0, 0, 0, 1], tail2: [0, 0, 0, 1], tess: [0, 0, 0, 0] },
    ...{ a0: [1, 0, 0], a1: [0, 1, 0], a2: [0, 0, 1] },
  }
  run.vsmRenderCullViews(caster, 5, 0, 1, 3, C.VSM_RENDER_CULL_SECOND)
  return { asked: [...new Set(asked)], emitted, hidden }
}

test('the cull asks the pages of a caster inside the band’s inner end for the primary request, and the pyramid’s test not', () => {
  const band = { ...level(true), dynamicDepthCullRange: [0.4, FLOAT32_MAX] }
  const inside = viewMasks(band, { clipLow: [0, 0, 0.1], clipHigh: [0, 0, 0.3] })
  assert.deepEqual([inside.asked, inside.emitted], [[DYNAMIC | PRIMARY], [DYNAMIC | PRIMARY]])
  assert.deepEqual(inside.hidden, [DYNAMIC], 'the pyramid tests the layer’s pages alone')
  const across = viewMasks(band, { clipLow: [0, 0, 0.1], clipHigh: [0, 0, 0.9] })
  assert.deepEqual([across.asked, across.emitted], [[DYNAMIC], [DYNAMIC]])
  const plain = viewMasks(level(false), { clipLow: [0, 0, 0.1], clipHigh: [0, 0, 0.9] })
  assert.deepEqual(plain.asked, [DYNAMIC])
})
