// The deferred resolve's lists run on a real GPU (#849, #1369): the shipped `directLightingWgsl` —
// its narrow program (a scene of at most `TILE_LIGHTS` lights) and its wide one — shades the same
// samples through `contractLighting`, on a cell record of the light grid and its list in the pool
// (`cellRecord`). The f32 sums are compared as bits: the narrow list, the wide list, a list past
// `TILE_LIGHTS` and the walk over every light of the scene give the same sum, bit for bit, since a
// light that misses a point adds an exact zero; and so do the programs a scene with no shadow
// (#1249) or no rectangle (#1369) is lit by, the full one less code that never runs there.
//
//   node bench/dawn/proofs.ts tests/gpu/lighting/narrow-resolve.gpu.ts
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import type { SceneLight } from '../../../packages/sdk-core/src/index.ts'
import { LIGHT_SETTINGS } from '../../../packages/sdk-core/src/index.ts'
import type { ResolveScene } from './resolvePage.ts'
import {
  assertSameBits,
  cellRecord,
  distance,
  resolveRandom,
  resolveSamples,
  runResolves,
} from './resolveCases.ts'

const LIST = LIGHT_SETTINGS.tileLights
const draw = resolveRandom(849)
const { r, between, vector, unit } = draw
const { points, samples } = resolveSamples(128, draw)

/** A sun, then point and spot lights, near the samples or far; none whose range sphere passes
 *  within 2% of a sample, so what reaches a sample is beyond doubt in f32. Returns the lights
 *  and the ranks of those that reach a sample: the tile's list. */
function scene(count: number, near: number) {
  const sun: SceneLight = {
    id: 'sun',
    kind: 'directional',
    direction: unit([0.3, -1, 0.2]),
    color: [1, 0.95, 0.9],
    intensity: 2,
    castsShadow: false,
  }
  const lights = [sun],
    reach = [0]
  while (lights.length < count) {
    const close = r() < near
    const position = vector(close ? 2.5 : 12) as [number, number, number]
    const range = close ? between(1.5, 4) : between(0.5, 3)
    const ratios = points.map((P) => distance(P, position) / range)
    if (ratios.some((ratio) => Math.abs(ratio - 1) < 0.02)) continue
    if (ratios.some((ratio) => ratio < 1)) reach.push(lights.length)
    const spot = r() < 0.4
    lights.push({
      id: `l${lights.length}`,
      kind: spot ? 'spot' : 'point',
      position,
      ...(spot ? { direction: unit(vector(1)), coneAngle: 0.7, penumbra: 0.3 } : {}),
      color: [between(0.2, 1), between(0.2, 1), between(0.2, 1)],
      intensity: between(1, 20),
      range,
      castsShadow: false,
    })
  }
  return { lights, reach }
}

/** A cell's record, named, in the narrow or wide program; with no `room`, every light of the
 *  scene. */
const record = (name: string, narrow: boolean, list: number[], room = true) => ({
  name,
  narrow,
  words: cellRecord(list, [], room),
})

// Within the lists: 60 lights, the narrow resolve and the wide one on the same list.
const small = scene(60, 0.5)
// Past a list: 300 lights, more than `TILE_LIGHTS` reach the cell, its list or no room at all.
const large = scene(300, 0.9)
const missing = small.reach.filter((light) => light !== small.reach[1])
const SCENES: ResolveScene[] = [
  {
    lights: small.lights,
    samples,
    records: [
      record('narrow', true, small.reach),
      record('wide', false, small.reach),
      record('every', false, small.reach, false),
      record('missing', false, missing),
      // The same list through the program with no shadow code, the scene holding no shadow slot.
      { ...record('unshadowed', false, small.reach), unshadowed: true },
      // The same list through the program with no rectangle code: the scene holds none (#1369).
      { ...record('rectless', false, small.reach), rectless: true },
      // The same list, each light taking the pixel's surface again (`lobeSurface`, #1483).
      { ...record('perLight', false, small.reach), perLight: true },
    ],
  },
  {
    lights: large.lights,
    samples,
    records: [record('pool', false, large.reach), record('overflow', false, large.reach, false)],
  },
]

let sums: Record<string, number[]> = {}
before(async () => {
  assert.ok(small.reach.length > 8 && small.reach.length <= LIST, `${small.reach.length} reach`)
  assert.ok(large.reach.length > LIST, `${large.reach.length} reach the large tile`)
  sums = Object.assign({}, ...(await runResolves(SCENES)))
  assert.equal(Object.keys(sums).length, 9, 'every record summed')
})

test('the narrow list, the wide one, a pool slice and every light sum the same, bit for bit', () => {
  const { narrow, wide, every, missing: dropped, pool, overflow } = sums
  assertSameBits(narrow, wide, 'the narrow resolve against the wide one')
  assertSameBits(wide, every, 'the list against every light')
  assertSameBits(pool, overflow, 'a pool slice against every light')
  // The sums are real: most samples are lit, and a list short of one reaching light is seen.
  const lit = (bits: number[]) =>
    points.filter((_, k) => bits.slice(4 * k, 4 * k + 3).some(Boolean))
  assert.ok(lit(narrow).length > 96 && lit(pool).length > 96, 'the samples are lit')
  assert.notDeepEqual(dropped, every, 'a missing light changes the sum')
})

test('the program with no shadow code sums what the full one does, bit for bit (#1249)', () => {
  assertSameBits(sums.unshadowed, sums.wide, 'no shadow code')
})

test('the program with no rectangle code sums what the full one does, bit for bit (#1369)', () => {
  assertSameBits(sums.rectless, sums.wide, 'no rectangle code')
})

test('the surface taken once a pixel sums what each light taking it again does, bit for bit', () => {
  assertSameBits(sums.wide, sums.perLight, 'the surface hoisted out of the light loop')
})
