// The shadow raster's cull as shipped (`renderCullWgsl.ts`): the places of the records' list, shared
// by the records to draw and those the occlusion's first cull holds back, and the caster that cull
// tests where the previous image drew it. Split from `../occlusion/occlusionTest.test.ts` by
// subject, as the bound on a test file's lines asks.

import test from 'node:test'
import assert from 'node:assert/strict'
import { FLOAT32_MAX } from '../../../../../../math/src/constants.ts'
import { wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { Mat, matrixProduct } from '../../../../materials/texture/shaderRunMatrix.fixture.ts'
import { vsmLayout } from '../layout.ts'
import { VSM_RENDER_ARGS_POST, VSM_RENDER_ARGS_WGSL } from './renderParamsWgsl.ts'
import { vsmRenderCullWgsl } from './renderCullWgsl.ts'

const CULL = vsmRenderCullWgsl(vsmLayout({ fullMapCapacity: 7, sunMapCapacity: 3 }))

// The records to draw and those held back share one list and one count of its places
// (`vsmRenderTake`): from its head and from its end, never one place for two, every place asked
// counted. Three windows to draw and
// three records to hold in a list of four places, in either order.
test('the records to draw and those held back share the list’s places, every place counted', () => {
  const C = wgslConstants(CULL)
  const room = 4
  for (const holdsFirst of [false, true]) {
    const counts = new Array(64).fill(0),
      records = Array.from({ length: room }, () => [-1, -1, -1, -1])
    const cull = shaderRun<{
      vsmRenderEmit(...a: unknown[]): void
      vsmRenderHold(...a: unknown[]): void
    }>(CULL, ['vsmRenderEmit', 'vsmRenderHold'], {
      ...C,
      counts,
      records,
      params: { recordCapacity: room },
      vsmTableLevelOrigin: () => ({}),
      vsmTableEntryAt: () => ({}),
      vsmPageMarkWord: () => 0xffffffff,
    })
    // A rect of three pages a row, a window of one page each: three records to draw.
    const draw = () => cull.vsmRenderEmit(9, 0, 0, {}, 0, [0, 0, 2, 0], 1, 1)
    const hold = () => {
      for (let k = 0; k < 3; k++) cull.vsmRenderHold(100 + k, 5, 0, false)
    }
    for (const step of holdsFirst ? [hold, draw] : [draw, hold]) step()
    const drawn = records.filter((r) => r[0] === 9).length,
      held = records.filter((r) => r[0] >= 100).length
    // One place for each, whoever asked first: none overwritten, none left empty.
    assert.equal(drawn + held, room, `holds first ${holdsFirst}: every place used once`)
    assert.equal(drawn, holdsFirst ? 1 : 3, `holds first ${holdsFirst}: the records drawn`)
    assert.equal(counts[C.VSM_RENDER_COUNT_TAKEN], 6, 'every place asked is counted')
    assert.equal(counts[C.VSM_RENDER_COUNT_HELD], held, 'the records held are the ones stored')
    // The held records lie where the second cull reads them, from the end.
    for (let i = 0; i < held; i++)
      assert.ok(records[room - 1 - i]![0]! >= 100, `holds first ${holdsFirst}: held ${i}`)
  }
})

/** The shipped `vsmRenderCullView` on a view and a candidate; the map's tables, the box cull and the
 *  occlusion's test stand in — `hiddenBefore` and `hiddenNow` the pyramids' verdicts —, and the
 *  records it holds back and draws are told. */
function viewCull(
  hiddenBefore: (centre: number[]) => boolean,
  hiddenNow: () => boolean = () => false,
) {
  const C = wgslConstants(CULL)
  const identity = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const map = {
    ...{ uncached: false, useCover: false, finestMip: 0, viewSlot: 0, wpoThreshold: 0 },
    dynamicDepthCullRange: [0, FLOAT32_MAX],
    ...{ lightViewToClip: identity, shiftedToMapUv: identity },
    ...{ originShiftHigh: [0, 0, 0], originShiftLow: [0, 0, 0] },
  }
  const inView = {
    ...{ inMapView: true, clipHigh: [0, 0, 1], clipLow: [0, 0, 0.5] },
    ...{ pastNear: false, pastFar: false },
  }
  const held: unknown[][] = [],
    drawn: unknown[][] = []
  const run = shaderRun<{ vsmRenderCullView(...a: unknown[]): void }>(CULL, ['vsmRenderCullView'], {
    ...C,
    params: {},
    vsm: { lodDeltaInvalidates: 0 },
    views: [[7, 1, 0, 3]],
    vsmHandleFromId: (id: number) => ({ id }),
    vsmProjectionOf: () => map,
    vsmShiftedToClip: (m: Mat) => m,
    vsmBoxCullPoint: () => [0, 0, 0],
    vsmBoxInView: () => inView,
    vsmClipRadius: () => 1,
    vsmIsFineCaster: () => false,
    vsmRenderLodAt: () => C.VSM_RENDER_LOD_OWN,
    vsmRectPixels: () => [0, 0, 16, 16],
    vsmClipToStaleRect: (pixels: number[]) => pixels,
    vsmTouchesMappedPixels: () => true,
    vsmRenderSwapped: () => false,
    vsmRenderTierOf: () => 0,
    vsmRenderSoftware: () => false,
    vsmHiddenBefore: (_map: object, centre: number[]) => hiddenBefore(centre),
    vsmHiddenNow: hiddenNow,
    vsmRenderHold: (...args: unknown[]) => held.push(args),
    vsmRenderEmit: (...args: unknown[]) => drawn.push(args),
  })
  const caster = (prevShift: number[]) => ({
    ...{ c: [10, 0, 0, 1], l: [0, 0, 0], row: 3, corners: 3, flags: 0, farDepth: 0 },
    ...{ own: [0, 0, 0, 1], parent: [0, 0, 0, 1], errors: [0, 0], edge: 0 },
    ...{ inst: [0, 0, 0, 1], viewBits: 0, offsetDisableSq: 0 },
    ...{ a0: [1, 0, 0], a1: [0, 1, 0], a2: [0, 0, 1] },
    prevShift,
  })
  const kind = (name: 'FIRST' | 'SECOND' | 'POST') => C[`VSM_RENDER_CULL_${name}`]
  return { run, held, drawn, caster, kind, map }
}

// The first cull holds a caster back where the previous image drew it (the candidate's `prevShift`
// added to the centre it tests), not where it is now: the one that moved from behind an occluder
// into the open is held, the one that stood in the open is drawn.
test('the first cull holds a moved caster where the previous image drew it, not where it is now', () => {
  // Hidden behind the previous image's pyramid for a centre left of 5: where the caster stood.
  const { run, held, drawn, caster, kind } = viewCull((centre) => centre[0] < 5)
  // At x = 10 now, at 0 before: tested at 0, hidden there, held — candidate 5, view 0, mip 0.
  run.vsmRenderCullView(caster([-10, 0, 0]), 5, 0, false, kind('FIRST'), 0)
  assert.deepEqual([held, drawn.length], [[[5, 0, 0, false]], 0], 'moved: held')
  // Still: tested where it is, in the open, drawn.
  held.length = 0
  run.vsmRenderCullView(caster([0, 0, 0]), 5, 0, false, kind('FIRST'), 0)
  assert.deepEqual([held.length, drawn.length], [0, 1], 'still: drawn')
})

// The second cull, over a record the first held back, and the post cull, over a caster the descent
// found behind a node the first pyramid hid, draw it where this frame's pyramid shows it and leave
// it out where it hides it; neither holds anything back.
test('the second and the post cull draw what this frame’s pyramid shows, and leave out what it hides', () => {
  let hidden = true
  const { run, held, drawn, caster, kind } = viewCull(
    () => true,
    () => hidden,
  )
  for (const name of ['SECOND', 'POST'] as const) {
    drawn.length = 0
    hidden = true
    run.vsmRenderCullView(caster([0, 0, 0]), 5, 0, false, kind(name), 0)
    assert.equal(drawn.length, 0, `${name}: hidden, left out`)
    hidden = false
    run.vsmRenderCullView(caster([0, 0, 0]), 5, 0, false, kind(name), 0)
    assert.equal(drawn.length, 1, `${name}: shown, drawn`)
  }
  assert.equal(held.length, 0, 'neither holds a record back')
})

// After the first records are drawn, the argument kernel of the second half resets the list's places
// beside the records held back and sizes the post cull over the casters found since the descent's
// post pass opened, a group of lanes each and a z for each listed light.
test('the second half’s arguments size the post cull over the casters found since the post pass opened', () => {
  const C = wgslConstants(VSM_RENDER_ARGS_WGSL)
  const argsFor = (casters: number, first: number) => {
    const counts = new Array(64).fill(0),
      args = new Array(64).fill(-1)
    counts[0] = casters
    counts[C.VSM_RENDER_COUNT_CAST_FIRST] = first
    counts[C.VSM_RENDER_COUNT_VIEWS] = 3
    counts[C.VSM_RENDER_COUNT_HELD] = 130
    shaderRun<{ vsmRenderArgsSecond(): void }>(VSM_RENDER_ARGS_WGSL, ['vsmRenderArgsSecond'], {
      ...C,
      counts,
      args,
      params: { lightCount: 5 },
    }).vsmRenderArgsSecond()
    return { counts, post: args.slice(VSM_RENDER_ARGS_POST, VSM_RENDER_ARGS_POST + 3) }
  }
  const found = argsFor(100, 40)
  assert.deepEqual(found.post, [1, 1, 3], '60 casters: a group, three lights')
  assert.equal(found.counts[C.VSM_RENDER_COUNT_TAKEN], 130, 'the places start beside the held')
  assert.deepEqual(argsFor(40, 40).post.slice(2), [0], 'none found: no light, nothing dispatched')
})

// The layer of a caster is the placement's, map by map: every cluster of a placement whose offset
// invalidates its shadows is cached as dynamic in the maps that allow the offset (the cluster wears
// one or not), and in the static layer of the others.
test('every cluster of a placement whose offset invalidates its shadows is drawn dynamic where the map allows the offset', () => {
  const { run, drawn, caster, kind, map } = viewCull(() => false)
  const C = wgslConstants(CULL)
  const STATIC_LAYER = 1 << 21
  const layerOf = (flags: number, offsetDisableSq: number, threshold: number) => {
    drawn.length = 0
    map.wpoThreshold = threshold
    const cand = { ...caster([0, 0, 0]), flags, offsetDisableSq }
    run.vsmRenderCullView(cand, 5, 0, false, kind('FIRST'), 0)
    assert.equal(drawn.length, 1)
    return (drawn[0]![1] as number) & STATIC_LAYER ? 'static' : 'dynamic'
  }
  const placement = C.VSM_RENDER_CAND_PLACEMENT_OFFSET
  assert.equal(layerOf(0, 0, 0), 'static', 'a plain caster')
  assert.equal(layerOf(placement, 0, 1e9), 'dynamic', 'an offset that never stops')
  assert.equal(layerOf(placement, 100, 99), 'dynamic', 'a level not past the distance')
  assert.equal(layerOf(placement, 100, 101), 'static', 'a level past the distance')
  const always = placement | C.VSM_RENDER_CAND_PLACEMENT_ALWAYS
  assert.equal(layerOf(always, 100, 101), 'dynamic', 'a surface that always evaluates it')
  const bare = C.VSM_RENDER_CAND_PLACEMENT_ALWAYS
  assert.equal(layerOf(bare, 100, 101), 'static', 'the always bit alone')
  assert.equal(layerOf(C.VSM_RENDER_CAND_DYNAMIC, 0, 0), 'dynamic', 'a placement that moves')
})

// The map's dynamic depth range cuts the casters that move: one whose far end (the box's highest
// clip depth) is not past its near limit is left out, as is one whose near end passes the far limit;
// a caster in the static layer is not cut by it.
test('a moving caster beyond the map’s dynamic depth range is culled, a static one is not', () => {
  const { run, drawn, caster, kind, map } = viewCull(() => false)
  const C = wgslConstants(CULL)
  // The box spans clip depths 0.5 to 1 in the stub (`clipLow.z`, `clipHigh.z`).
  const drawnWith = (flags: number, range: [number, number]) => {
    drawn.length = 0
    map.dynamicDepthCullRange = range
    run.vsmRenderCullView({ ...caster([0, 0, 0]), flags }, 5, 0, false, kind('FIRST'), 0)
    return drawn.length === 1
  }
  const moving = C.VSM_RENDER_CAND_DYNAMIC
  assert.ok(drawnWith(moving, [0, FLOAT32_MAX]), 'no limit: drawn')
  assert.ok(drawnWith(moving, [0.9, FLOAT32_MAX]), 'its far end (1) is past the near limit 0.9')
  assert.ok(!drawnWith(moving, [1, FLOAT32_MAX]), 'its far end is not past the near limit 1')
  assert.ok(!drawnWith(moving, [0, 0.5]), 'its near end (0.5) is not short of the far limit 0.5')
  assert.ok(drawnWith(0, [1, FLOAT32_MAX]), 'a static caster: the range does not cut it')
})

// The frustum cull tests the caster's box, not a cube about its sphere: a thin box (100 x 1 x 1) lying
// along the map's x axis, turned 45 degrees in the world, whose sphere's cube reaches the frustum
// while its own body lies a long way off the frustum's side is culled; the same box through the
// frustum is kept.
test('the cull tests the caster’s oriented box: a thin turned box off the frustum is culled, the cube about its sphere would keep it', () => {
  const identity = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  // The shifted space turned 45 degrees about z to the map's clip space (an orthographic map).
  const c = Math.SQRT1_2
  const toClip = new Mat([c, -c, 0, 0, c, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const cull = shaderRun<{
    vsmCasterBoxInView(...a: unknown[]): { inMapView: boolean }
    vsmBoxCullPoint(...a: unknown[]): number[]
    vsmBoxInView(...a: unknown[]): { inMapView: boolean }
  }>(CULL, ['vsmCasterBoxInView', 'vsmBoxCullPoint', 'vsmBoxInView'], wgslConstants(CULL))
  // Half axes in the world: 50 along the box's length (the map's x), 0.5 across it, 0.5 in z.
  const along = 50 * c,
    across = 0.5 * c
  const axes = [
    [along, along, 0],
    [-across, across, 0],
    [0, 0, 0.5],
  ]
  const radius = Math.hypot(50, 0.5, 0.5)
  // The cube about the sphere is the cull's former volume.
  const cube = (centre: number[]) => {
    const extent = [radius, radius, radius]
    const point = cull.vsmBoxCullPoint(centre, extent, true, true)
    return cull.vsmBoxInView(
      matrixProduct(toClip, [...point, 1]),
      toClip[0],
      toClip[1],
      toClip[2],
      extent,
      identity,
      true,
      true,
    )
  }
  const box = (centre: number[]) =>
    cull.vsmCasterBoxInView(centre, ...axes, toClip, identity, true, true)
  // 30 clip units off the map's x axis: the body (y within 0.5 of 30) clears the frustum (|y| <= 1),
  // the cube (50 a side along the world's axes, 70 in clip) does not.
  const off = [-30 * c, 30 * c, 0.5]
  assert.equal(cube(off).inMapView, true, 'the cube about the sphere reaches the frustum')
  assert.equal(box(off).inMapView, false, 'the box itself does not')
  assert.equal(box([0, 0, 0.5]).inMapView, true, 'through the frustum, it is kept')
})
