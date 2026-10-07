// The water composite walks its declared lights once (`declaredLightingPair`) for the two sums it
// took from two walks: its lit colour, and its reflection's specular on a null albedo. The shipped
// pair loop runs as JavaScript (`shaderRun`) against the shipped single loop of the blend pass,
// called twice as the composite called it — with the surface's albedo and metal, then with
// `vec3f(0.0)` and `0.0` —, and both sums are the same numbers, bit for bit: random lamp sets,
// shadowed or not, in the standard, diffuse and toon models, thin or not, on a cell's list and on
// every lamp. The rectangle's terms, which need the LTC table, are read in the text: each second
// term is the first with the null albedo for the surface's.
import { lerp } from '../../../../math/src/scalar/reals.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { functionsOf, wgslConstants } from '../../texture/shaderRule.fixture.ts'
import { STANDARD_LIGHTING_WGSL } from '../../lighting/standardLighting.ts'
import { declaredLightingWgsl } from '../../lighting/direct/lightingWgsl.ts'
import { shadedLightScope } from '../blend/shadedLightScope.fixture.ts'
import { waterCompositeShader } from './compositeWgsl.ts'

type Sum = (...args: unknown[]) => number[]
type Pair = (...args: unknown[]) => { lit: number[]; specular: number[] }
// The program without lobe code; the lobed one's pair is `lobedPair.test.ts`'s.
const WATER = waterCompositeShader(false, { lobeless: true })
const SINGLE = `${declaredLightingWgsl({ proxy: 13, transmittance: 18 })}${STANDARD_LIGHTING_WGSL}`
const K = wgslConstants(WATER)
const SHARED = ['directIncidence', 'rangeWindow', 'isSun', 'isSunKind', 'isRect']
const SHADING = [
  'lobeSurface',
  'surfaceLight',
  'standardLobe',
  'fresnelSchlick',
  'ggxDistribution',
  'modelLight',
  'thinTransmission',
]

const same = (a: number[], b: number[]) => a.every((v, i) => Object.is(v, b[i]))

test('one walk of the lights gives the two sums of two walks, bit for bit', () => {
  const r = random(1563),
    u = (lo: number, hi: number) => lerp(lo, hi, r())
  let lit = 0
  for (let round = 0; round < 600; round++) {
    const count = 1 + Math.floor(u(0, 24))
    const P = [u(-5, 5), u(-1, 3), u(-5, 5)]
    const items = [...Array(count).keys()].map((rank) => {
      const spot = rank % 3 === 0
      return {
        positionRange: [P[0] + u(-4, 4), P[1] + u(-4, 4), P[2] + u(-4, 4), u(0.1, 8)],
        colorIntensity: [u(0, 1), u(0, 1), u(0, 1), u(0, 20)],
        directionCone: [0, -1, 0, spot ? 0.7 : -1],
        params: [spot ? K.KIND_SPOT : 0, rank % 2 ? rank : -1, 0, spot ? 0.9 : 0],
        shape: [0, 0, 0, 0],
      }
    })
    const { normal: N, scope: shared } = shadedLightScope(r, u, K, count, items, round)
    const V = [0.6, 0.8, 0]
    const scope = { ...shared, shadowTransmission: [0.9, 0.7, 0.5] }
    const { sliceLightingPair } = shaderRun<{ sliceLightingPair: Pair }>(
      WATER,
      ['sliceLightingPair', 'declaredLightPair', ...SHARED, ...SHADING],
      { ...scope, LightPair: (a: number[], b: number[]) => ({ lit: a, specular: b }) },
    )
    const { sliceLighting } = shaderRun<{ sliceLighting: Sum }>(
      SINGLE,
      ['sliceLighting', 'declaredLight', ...SHARED, ...SHADING],
      scope,
    )
    const [rgb, metal, rough] = [[u(0, 1), u(0, 1), u(0, 1)], u(0, 1), u(0.06, 1)]
    for (const slice of [
      [2, scope.tileLights.length - 2],
      [K.TILE_NO_SLICE, count],
    ]) {
      const pair = sliceLightingPair(rgb, metal, rough, N, V, P, 1, slice)
      const surface = sliceLighting(rgb, metal, rough, N, V, P, 1, slice)
      const specular = sliceLighting([0, 0, 0], 0, rough, N, V, P, 1, slice)
      assert.ok(same(pair.lit, surface), `round ${round}: ${pair.lit} against ${surface}`)
      assert.ok(
        same(pair.specular, specular),
        `round ${round}: ${pair.specular} against ${specular}`,
      )
      lit += +(surface.some((v) => v > 0) && specular.some((v) => v > 0))
    }
  }
  assert.ok(lit > 600, `${lit} of 1200 sums lit on both sides`)
})

test('every term of the pair is the single term, then the same on a null albedo', () => {
  const pair = functionsOf(WATER, ['declaredLightPair'])
  const single = functionsOf(SINGLE, ['declaredLight'])
  const terms = [...pair.matchAll(/return LightPair\((.*)\);/g)].map(([, both]) => both)
  assert.equal(terms.length, 5)
  for (const both of terms) {
    if (both === 'vec3f(0.0),vec3f(0.0)') continue
    const [first, second] = both.split(/,(?=(?:rectLight|\(modelLight|\(surfaceLight)\()/)
    assert.ok(single.includes(`return ${first};`), first)
    assert.equal(
      second,
      first
        .replace('(light,rgb,metal,', '(light,vec3f(0.0),0.0,')
        .replace(/\(rgb,metal,/, '(vec3f(0.0),0.0,')
        .replace('(shading,', '(dielectric,'),
    )
  }
  // The same shared prefix: the pair's body is the single's with its returns as pairs.
  const strip = (text: string) =>
    text.replace(/return [^;]*;/g, 'return;').replace(/^fn \w+\([^)]*\)->\w+/, '')
  assert.equal(strip(pair), strip(single))
})
