// The pass that evaluates the light functions the atlas holds no slot of: its program assembles, its coordinate and its share are the
// reference's, and what it writes is what the masks and the direct light read.
import test from 'node:test'
import assert from 'node:assert/strict'
import { toHalf } from '../../../../../math/src/float/half.ts'
import { wgslSource } from '../../../../../math/src/wgsl/source.fixture.ts'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { wgslBufferBindings } from '../../../gpu/core/wgslBindings.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { KINDS } from '../../lightFunction/layout.ts'
import { cullWgsl } from './cullWgsl.ts'
import {
  LIGHT_FUNCTION_PASS_BINDINGS,
  LIGHT_FUNCTION_PASS_ENTRY,
  lightFunctionPassBytes,
  lightFunctionPassWgsl,
} from './lightFunctionPassWgsl.ts'

const plain = lightFunctionPassWgsl({ mapped: false })
const mapped = lightFunctionPassWgsl({ mapped: true })

test('the program assembles, for a plain material and for one that reads a map', () => {
  assertProgramAssembles(plain, LIGHT_FUNCTION_PASS_ENTRY)
  assertProgramAssembles(mapped, LIGHT_FUNCTION_PASS_ENTRY)
})

test('it binds five storage buffers at most with the map’s page table, the light’s block at a dynamic offset a light', () => {
  const B = LIGHT_FUNCTION_PASS_BINDINGS
  assert.deepEqual(wgslBufferBindings(plain), [
    { binding: 0, type: 'uniform' },
    { binding: B.tables, type: 'read-only-storage' },
    { binding: B.counts, type: 'read-only-storage' },
    { binding: B.lightTiles, type: 'read-only-storage' },
    { binding: B.masks, type: 'storage' },
    { binding: B.given, type: 'uniform' },
  ])
  assert.equal(wgslBufferBindings(mapped).filter(({ type }) => type !== 'uniform').length, 5)
  assert.equal(lightFunctionPassBytes({ mapped: false }), 96 + 16)
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
  }>(plain, ['lightFunctionUv', 'lightFunctionShare'], { given: block, lp: { eye: [0, 0, 0, 0] } })

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

test('the shares go to the scratch two to a word, a light tile’s 32 words after the masks; the masks, the direct light and the pass agree on where', () => {
  assert.match(
    plain,
    /masks\[scratchWordOf\(lightTile,2u\*lane\)\]=pack2x16float\(vec2f\(shares\[2u\*lane\],shares\[2u\*lane\+1u\]\)\);/,
  )
  assert.match(plain, /if\(lane<SCRATCH_TILE_WORDS\)/)
  const common = shaderRun<{
    tileLightRank: (word: number) => number
    tileLightStandalone: (word: number) => boolean
    scratchWordOf: (lightTile: number, i: number) => number
    scratchFactorIn: (word: number, i: number) => number
  }>(
    wgslSource(cullWgsl(4)),
    ['tileLightRank', 'tileLightStandalone', 'scratchWordOf', 'scratchFactorIn'],
    { lp: { scratchAt: 1000 } },
  )
  const marked = (2 ** 31 + 77) >>> 0
  assert.equal(common.tileLightRank(marked), 77)
  assert.equal(common.tileLightStandalone(marked), true)
  assert.equal(common.tileLightStandalone(77), false)
  assert.equal(common.scratchWordOf(0, 0), 1000)
  assert.equal(common.scratchWordOf(3, 5), 1000 + 3 * 32 + 2)
  assert.equal(common.scratchWordOf(0, 63), 1000 + 31)
  const word = (toHalf(0.5) | (toHalf(0.25) << 16)) >>> 0
  assert.equal(common.scratchFactorIn(word, 4), 0.5)
  assert.equal(common.scratchFactorIn(word, 5), 0.25)
})
