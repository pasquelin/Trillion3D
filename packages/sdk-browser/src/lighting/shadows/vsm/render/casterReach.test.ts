// What the casters hand the shadow raster's cull (`renderCandidatesWgsl.ts`, `renderCullWgsl.ts`):
// the errors a level of detail compares, scaled by the placement's smallest axis scale as the
// camera's cut scales them, the candidate's layout, and the cutout of a masked row, evaluated only
// for a depth that can win. (The box that holds the reach of the offsets only in the maps that
// allow them: `renderCull.test.ts`.)

import test from 'node:test'
import assert from 'node:assert/strict'
import { functionsOf, wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { Mat3 } from '../../../../materials/texture/shaderRunMatrix.fixture.ts'
import { DAG_AXIS_SCALES_WGSL } from '../../../../geometry/dag/shader/primitiveWgsl.ts'
import { vsmRenderCandidatesWgsl } from './renderCandidatesWgsl.ts'
import { VSM_OFFSET_GROWS_WGSL } from '../invalidation/boxCullWgsl.ts'
import { vsmRenderRasterWgsl } from './renderRasterWgsl.ts'
import { vsmRenderSoftwareWgsl } from './renderSoftwareWgsl.ts'
import { SUNS_LAYOUT } from '../layout.fixture.ts'

const LAYOUT = SUNS_LAYOUT
const CASTERS = vsmRenderCandidatesWgsl()

test('a placement’s axis scales are the lengths of its matrix’s columns, the error taking the smallest', () => {
  const { axisScales, minAxisScale } = shaderRun<{
    axisScales(l: Mat3): number[]
    minAxisScale(l: Mat3): number
  }>(DAG_AXIS_SCALES_WGSL, ['axisScales', 'minAxisScale'], {})
  const stretched = new Mat3([
    [0, 2, 0],
    [0.5, 0, 0],
    [0, 0, 3],
  ])
  // Columns of length 2, 0.5 and 3: a stretched placement.
  assert.deepEqual(Array.from(axisScales(stretched)), [0.5, 3])
  assert.equal(minAxisScale(stretched), 0.5)
  const sheared = new Mat3([
    [3, 4, 0],
    [0, 1, 0],
    [0, 0, 2],
  ])
  assert.deepEqual(Array.from(axisScales(sheared)), [1, 5])
  assert.equal(minAxisScale(sheared), 1)
  assert.equal(
    minAxisScale(
      new Mat3([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]),
    ),
    1,
  )
})

test('the errors a caster hands the cull are scaled by the smallest axis scale, a root’s parent staying negative', () => {
  const { vsmRenderErrors } = shaderRun<{ vsmRenderErrors(...a: unknown[]): number[] }>(
    CASTERS,
    ['vsmRenderErrors'],
    {},
  )
  assert.deepEqual(Array.from(vsmRenderErrors(0.5, 2, 0.25)), [0.125, 0.5])
  assert.deepEqual(Array.from(vsmRenderErrors(0.5, -1, 0.25)), [0.125, -1], 'a root')
  // A placement flattened along an axis scales every error to none, but a root still has no parent.
  assert.deepEqual(Array.from(vsmRenderErrors(0.5, -1, 0)), [0, -1])
})

test('a map allows the offset that applies, evaluated always or within the distance its object stops at', () => {
  const { vsmOffsetGrows } = shaderRun<{ vsmOffsetGrows(...a: unknown[]): boolean }>(
    VSM_OFFSET_GROWS_WGSL,
    ['vsmOffsetGrows'],
    {},
  )
  assert.equal(vsmOffsetGrows(false, true, 0, 0), false, 'does not apply')
  assert.equal(vsmOffsetGrows(true, false, 0, 99), true, 'no distance')
  assert.equal(vsmOffsetGrows(true, false, 4, 4), true)
  assert.equal(vsmOffsetGrows(true, false, 4, 5), false, 'past the distance')
  assert.equal(vsmOffsetGrows(true, true, 4, 5), true, 'always evaluated')
})

// A masked row's fragment asks the pool for its word before it evaluates the cutout: a depth no
// greater than the held one writes nothing (`vsmPoolAtomicMax`), so the cutout of a fragment that
// cannot win is never run. The pixels that win are the same ones.
test('a depth wins the pool only where it is greater than the word held, in the layer’s slice', () => {
  const code = vsmRenderRasterWgsl(LAYOUT)
  const held = [0, 0]
  const joined: unknown[][] = []
  const { vsmRenderBeats, vsmRenderDepth, vsmRenderSlice, vsmRenderJoin } = shaderRun<{
    vsmRenderBeats(...a: unknown[]): boolean
    vsmRenderDepth(z: number): number
    vsmRenderSlice(window: number[]): number
    vsmRenderJoin(...a: unknown[]): void
  }>(code, ['vsmRenderBeats', 'vsmRenderDepth', 'vsmRenderSlice', 'vsmRenderJoin'], {
    ...wgslConstants(code),
    vsm: { staticSlice: 1 },
    vsmPoolLoad: (_texel: number[], slice: number) => held[slice],
    vsmPoolAtomicMax: (...a: unknown[]) => joined.push(a),
  })
  const bits = (z: number) => vsmRenderDepth(z)
  held[0] = bits(0.5)
  held[1] = bits(0.25)
  // Greater wins, equal and lower do not; reversed depth: the nearer the light, the greater.
  assert.equal(vsmRenderBeats([0, 0], 0, bits(0.75)), true)
  assert.equal(vsmRenderBeats([0, 0], 0, bits(0.5)), false)
  assert.equal(vsmRenderBeats([0, 0], 0, bits(0.25)), false)
  assert.equal(vsmRenderBeats([0, 0], 0, bits(7)), true, 'clamped to one')
  assert.equal(vsmRenderBeats([0, 0], 0, bits(-3)), false, 'clamped to zero')
  assert.equal(bits(7), bits(1))
  assert.ok(bits(0.25) < bits(0.5) && bits(0.5) < bits(0.75), 'the bits order as the depths do')
  // The static layer reads the slice it writes.
  assert.equal(vsmRenderBeats([0, 0], 1, bits(0.3)), true)
  assert.equal(vsmRenderBeats([0, 0], 1, bits(0.2)), false)
  // A window is its first page, the static layer's bit with the mip above it, and its extent.
  assert.deepEqual(
    [
      [0, 0, 0],
      [0, 1, 0],
      [0, 2, 0],
      [0, 3, 0],
    ].map(vsmRenderSlice),
    [0, 1, 0, 1],
    'the layer, whatever the mip',
  )
  vsmRenderJoin([0, 1, 0], [3, 4], bits(0.9))
  assert.deepEqual(joined, [[[3, 4], 1, bits(0.9)]], 'the word joins the layer’s slice')
})

test('a masked row is tested against the pool before its cutout in either raster', () => {
  const fragment = functionsOf(vsmRenderRasterWgsl(LAYOUT), ['vsmRenderFs'])
  assert.ok(fragment.indexOf('vsmRenderBeats(') < fragment.indexOf('maskKeep('))
  const pixel = functionsOf(vsmRenderSoftwareWgsl(LAYOUT), ['pixelKeeps'])
  assert.ok(pixel.indexOf('vsmRenderBeats(') < pixel.indexOf('triCutout'))
})
