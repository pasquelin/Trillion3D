// The shadow raster's cull of a caster against a map (`renderCullWgsl.ts`): the caster's layer, the map's
// depth range and frustum, and the box it tests.

import test from 'node:test'
import assert from 'node:assert/strict'
import { FLOAT32_MAX } from '../../../../../../math/src/constants.ts'
import { wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { Mat, matrixProduct } from '../../../../materials/texture/shaderRunMatrix.fixture.ts'
import { CULL, viewCull } from './renderCullView.fixture.ts'

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
    run.vsmRenderCullViews(cand, 5, 0, 1, 3, kind('FIRST'))
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
    run.vsmRenderCullViews({ ...caster([0, 0, 0]), flags }, 5, 0, 1, 3, kind('FIRST'))
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

// The box the cull tests is the candidate's half axes where the map grows the bounds of its
// placement by the reach of its offset (`vsmOffsetGrows`), and each axis scaled by the candidate's
// fit (`vsmCandFit`, the deformation's reach alone) where it does not.
test('a map that does not allow a placement’s offset culls the box its deformation alone makes', () => {
  const C = wgslConstants(CULL)
  const { run, boxes, caster, kind, map } = viewCull(() => false)
  const OFFSET = C.VSM_RENDER_CAND_PLACEMENT_OFFSET!,
    ALWAYS = C.VSM_RENDER_CAND_PLACEMENT_ALWAYS!
  const axes = (flags: number, threshold: number) => {
    map.wpoThreshold = threshold
    boxes.length = 0
    const cand = {
      ...caster([0, 0, 0]),
      ...{ a0: [2, 0, 0], a1: [0, 4, 0], a2: [0, 0, 8], tail0: [0.5, 0.25, 1, 1] },
      ...{ flags, offsetDisableSq: 4 },
    }
    run.vsmRenderCullViews(cand, 5, 0, 1, 3, kind('FIRST'))
    return boxes[0]!.slice(1, 4).map((axis) => Array.from(axis as number[]))
  }
  const whole = [
    [2, 0, 0],
    [0, 4, 0],
    [0, 0, 8],
  ]
  const bare = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 8],
  ]
  assert.deepEqual(axes(OFFSET, 1), whole, 'a level within the distance: the offset grows it')
  assert.deepEqual(axes(OFFSET, 9), bare, 'a level past it: the deformation’s box')
  assert.deepEqual(axes(OFFSET | ALWAYS, 9), whole, 'evaluated whatever the distance says')
  assert.deepEqual(axes(0, 1), bare, 'an offset that may not invalidate: no map grows it')
})
