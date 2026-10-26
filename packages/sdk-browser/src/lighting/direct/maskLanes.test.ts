// The lane of a local light in its pixel's mask (`vsmMaskLaneOf`): its place in the shadowed lights of the
// pixel's cell (`lightGridWgsl.ts`), the order the projection packs them in — the shadowed local lights whose
// map is more than a page first, those of a single page last, each group in the order of the cell's list; a
// sun and a light with no shadow take none, a light past the mask's lanes reads its own map.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { directShadowWgsl } from './shadowWgsl.ts'
import { shadowSliceOf } from './shadowSlice.ts'
import { CONTRACT_SHADOW_BINDINGS } from './shadowBindings.ts'
import { TILE_NO_SLICE } from '../tiles/noSlice.ts'

const CODE = wgslModule(
  directShadowWgsl({
    pass: 'mask',
    sun: CONTRACT_SHADOW_BINDINGS.vsmSunMask,
    local: CONTRACT_SHADOW_BINDINGS.vsmMask,
    fallback: CONTRACT_SHADOW_BINDINGS.fallback,
  }),
)

const slices = [
  shadowSliceOf(0, true, false), // a sun
  shadowSliceOf(1, false, true), // a single page
  -1, // no shadow
  shadowSliceOf(2, false, false),
  shadowSliceOf(3, false, true), // a single page
  shadowSliceOf(4, false, false),
]
const directLights = { items: slices.map((slice) => ({ params: [0, slice, 0, 0] })) }

test('the shadowed lights follow the cell’s list: the near maps first, the single pages last, no sun nor unshadowed light', () => {
  const { vsmShadowedWalk } = shaderRun<{ vsmShadowedWalk: (lane: number) => number[] }>(
    CODE,
    ['vsmShadowedWalk', 'vsmShadowedOf', 'shadowSliceIsSun', 'shadowSliceDistant'],
    { directLights: { ...directLights, count: slices.length } },
  )
  assert.deepEqual(
    [0, 1, 2, 3].map((lane) => vsmShadowedWalk(lane)[0]),
    [3, 5, 1, 4],
  )
  assert.equal(vsmShadowedWalk(TILE_NO_SLICE)[1], 4, 'every shadowed light counted')
})

test('a light’s lane is its place in its cell’s shadowed lights, past the mask’s lanes none', () => {
  const shadowed = [3, 5, 1, 4]
  const { vsmMaskLaneOf } = shaderRun<{ vsmMaskLaneOf: (slice: number) => number }>(
    CODE,
    ['vsmMaskLaneOf'],
    {
      directLights,
      TILE_NO_SLICE,
      vsm: { onePassMaxLights: 3 },
      vsmShadowedList: () => [0, shadowed.length],
      vsmShadowedRank: (_list: number[], lane: number) => shadowed[lane],
    },
  )
  assert.deepEqual(
    [3, 5, 1].map((rank) => vsmMaskLaneOf(slices[rank])),
    [0, 1, 2],
  )
  assert.equal(vsmMaskLaneOf(slices[4]), 3, 'past the lanes: its own map')
})
