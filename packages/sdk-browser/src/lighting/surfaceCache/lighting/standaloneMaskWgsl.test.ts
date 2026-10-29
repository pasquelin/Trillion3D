// The light functions the atlas holds no slot of, evaluated inside the shadow mask's kernel: the material's program assembles, its coordinate
// and its share are the reference's, and the generic mask leaves the tiles of such a light to it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslSource } from '../../../../../math/src/wgsl/source.fixture.ts'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { wgslBindingNumbers, wgslBufferBindings } from '../../../gpu/core/wgslBindings.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { KINDS } from '../../lightFunction/layout.ts'
import { MAP_BINDINGS, MAP_SAMPLER_BINDING } from '../../lightFunction/mapBindings.ts'
import { cullWgsl } from './cullWgsl.ts'
import { SHADOW_MASK_STANDALONE_ENTRY, shadowMaskProgramOf } from './shadowMaskWgsl.ts'
import {
  STANDALONE_MASK_GIVEN_BINDING,
  standaloneMaskBytes,
  standaloneMaskMaterial,
  standaloneMaskWgsl,
} from './standaloneMaskWgsl.ts'

const plainGrey = standaloneMaskWgsl({ mapped: false }, 'grey')
const plainColour = standaloneMaskWgsl({ mapped: false }, 'colour')
const mappedGrey = standaloneMaskWgsl({ mapped: true }, 'grey')

test('the program assembles, for a plain material and for one that reads a map, in both formats of the masks', () => {
  assertProgramAssembles(plainGrey, SHADOW_MASK_STANDALONE_ENTRY)
  assertProgramAssembles(plainColour, SHADOW_MASK_STANDALONE_ENTRY)
  assertProgramAssembles(mappedGrey, SHADOW_MASK_STANDALONE_ENTRY)
  assertProgramAssembles(
    standaloneMaskWgsl({ mapped: true }, 'colour'),
    SHADOW_MASK_STANDALONE_ENTRY,
  )
})

test('the mask’s bindings stay in group 0, the light’s block at a dynamic offset a light and the maps are group 1’s, eight storage buffers at most with the map’s page table', () => {
  assert.deepEqual(wgslBufferBindings(plainGrey), wgslBufferBindings(shadowMaskProgramOf('grey')))
  assert.deepEqual(wgslBindingNumbers(plainGrey, 1), [STANDALONE_MASK_GIVEN_BINDING])
  assert.deepEqual(
    wgslBindingNumbers(mappedGrey, 1),
    [
      STANDALONE_MASK_GIVEN_BINDING,
      ...MAP_BINDINGS.lanes,
      MAP_BINDINGS.pages,
      MAP_SAMPLER_BINDING,
    ].sort((a, b) => a - b),
  )
  assert.match(
    mappedGrey,
    new RegExp(`@group\\(1\\) @binding\\(${MAP_BINDINGS.pages}\\) var<storage,read>`),
  )
  assert.equal(wgslBufferBindings(mappedGrey).filter(({ type }) => type !== 'uniform').length, 7)
  assert.equal(standaloneMaskBytes({ mapped: false }), 96 + 16)
})

const IDENTITY = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
]
const given = (kind: number, tangent = 1, fade = 100, disabled = 0.5) => ({
  light: { toLight: IDENTITY, shape: [tangent, fade, disabled, 0], ids: [7, kind, 0, 0] },
})
const run = (block: ReturnType<typeof given>) =>
  shaderRun<{
    lightFunctionUv: (P: number[]) => number[]
    lightFunctionShare: (colour: number[], P: number[]) => number
  }>(plainGrey, ['lightFunctionUv', 'lightFunctionShare'], {
    given: block,
    lp: { eye: [0, 0, 0, 0] },
  })

test('the coordinate is the light vector in the light’s axes with x and z swapped: a spot’s through its cone, a point’s by longitude and latitude, any other’s as it is, none wrapped', () => {
  const P = [2, 0.5, 1]
  // The matrix at identity takes (2, 0.5, 1) to the light vector (1, 0.5, 2) once swapped.
  assert.deepEqual(run(given(KINDS.directional)).lightFunctionUv(P), [1, 0.5])
  assert.deepEqual(run(given(KINDS.rect)).lightFunctionUv(P), [1, 0.5])
  const spot = run(given(KINDS.spot, 0.5)).lightFunctionUv(P)
  assert.ok(Math.abs(spot[0] - 1.0) < 1e-6 && Math.abs(spot[1] - 0.75) < 1e-6)
  const length = Math.hypot(1, 0.5, 2)
  const point = run(given(KINDS.point)).lightFunctionUv(P)
  assert.ok(Math.abs(point[0] - (Math.atan2(0.5, 1) + Math.PI) / (2 * Math.PI)) < 1e-6)
  assert.ok(Math.abs(point[1] - Math.acos(2 / length) / Math.PI) < 1e-6)
  // A point past the unit square keeps its coordinate: the material’s own wrap handles it.
  assert.deepEqual(run(given(KINDS.directional)).lightFunctionUv([3, -2, 5]), [5, -2])
})

test('the share is the grey of the colour by 0.3333, faded to the disabled brightness over the last fifth of the fade distance, held to 0 to 1', () => {
  const { lightFunctionShare } = run(given(KINDS.directional, 1, 100, 0.5))
  const colour = [0.3, 0.6, 0.9]
  const grey = (0.3 + 0.6 + 0.9) * 0.3333
  assert.ok(Math.abs(lightFunctionShare(colour, [3, 4, 0]) - grey) < 1e-6, 'near: the grey')
  assert.ok(
    Math.abs(lightFunctionShare(colour, [100, 0, 0]) - 0.5) < 1e-6,
    'at the fade distance: the disabled brightness',
  )
  const alpha = (100 - 95) / 20
  assert.ok(Math.abs(lightFunctionShare(colour, [95, 0, 0]) - (0.5 + (grey - 0.5) * alpha)) < 1e-6)
  assert.equal(lightFunctionShare([5, 5, 5], [1, 0, 0]), 1, 'held to 1')
  assert.equal(lightFunctionShare([-5, -5, -5], [1, 0, 0]), 0, 'held to 0')
})

test('the generic mask leaves the tiles of a light apart from the atlas to its material’s program, reaching the barriers as the rest do; the material’s program leaves none', () => {
  const generic = shadowMaskProgramOf('grey')
  assert.match(generic, /let skip=tileLightStandalone\(listed\);/)
  assert.match(plainGrey, /let skip=false;/)
  for (const text of [generic, plainGrey]) {
    assert.match(text, /if\(!skip\)\{ray=lightAttenuation\(/)
    assert.match(text, /if\(lane<SHADOW_MASK_TILE_WORDS&&!skip\)\{masks\[/)
    // The tile is skipped by a value, not a return: no return stands between the workgroup's barriers.
    const body = text.slice(text.indexOf('fn shadowMaskTiles('))
    const afterFirstBarrier = body.slice(body.indexOf('workgroupBarrier();'))
    assert.doesNotMatch(afterFirstBarrier, /return;/)
  }
  assert.doesNotMatch(generic, /standaloneShare/)
})

test('the material’s share multiplies the factor after the atlas’s function and before the clouds’ shade and the profile, and settles the texel as they do', () => {
  const attenuation = plainGrey.slice(plainGrey.indexOf('fn lightAttenuation('))
  const atlas = attenuation.indexOf('ray.factor*=lightFunctionShade(lightFunctionOf(light,P));')
  const share = attenuation.indexOf('ray.factor*=standaloneShare(page,origin,P);')
  const clouds = attenuation.indexOf('ray.factor*=cloudShadowOnSurface(rank,P);')
  const profile = attenuation.indexOf('ray.factor*=lightProfileOf(light,P);')
  assert.ok(atlas > 0 && atlas < share && share < clouds && clouds < profile)
  assert.match(
    attenuation.slice(share - 60, share + 140),
    /if\(!ray\.complete&&standalone\)\{\s*ray\.factor\*=standaloneShare\(page,origin,P\);\s*ray\.complete=!isVisibleToLight\(ray\.factor\);/,
  )
})

test('the program dispatches over the tiles of the slot of the light its block names', () => {
  assert.match(plainGrey, /let tiles=slotTiles\(LT_BATCHABLE\+given\.light\.ids\.x\);/)
  assert.equal(standaloneMaskMaterial({ mapped: false }).declarations.length, 0)
  assert.equal(standaloneMaskMaterial({ mapped: true }).declarations.length, 1)
})

test('the tile word names the light’s rank and whether the atlas holds no slot of its function', () => {
  const common = shaderRun<{
    tileLightRank: (word: number) => number
    tileLightStandalone: (word: number) => boolean
  }>(wgslSource(cullWgsl(4)), ['tileLightRank', 'tileLightStandalone'], {})
  const marked = (2 ** 31 + 77) >>> 0
  assert.equal(common.tileLightRank(marked), 77)
  assert.equal(common.tileLightStandalone(marked), true)
  assert.equal(common.tileLightStandalone(77), false)
})
