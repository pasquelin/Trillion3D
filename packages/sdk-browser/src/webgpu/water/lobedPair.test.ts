// The water composite's lobed program (`lobesWgsl.ts`, a key without `lobeless`) walks its lights
// once for two sums (`declaredLightingPair`): its lit colour through the pixel's lobes, and its
// reflection's specular on a null albedo — whose anisotropic lobe takes a dielectric's reflectance
// (`DIELECTRIC_F0`), not the surface's the lobes were set for. The shipped pair loop runs as
// JavaScript (`shaderRun`) against the blend pass's lobed single loop called twice — on the surface
// with its lobes, then on a null albedo under the same lobes —: the same numbers, bit
// for bit, on random lamp sets, lobes and surfaces. Lobes off, or set with neither a strength nor a
// coat, the lobed pair sums what the program without lobe code sums, bit for bit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../texture/shaderRule.fixture.ts'
import { STANDARD_LIGHTING_WGSL } from '../../lighting/standardLighting.ts'
import { declaredLightingWgsl } from '../../lighting/direct/lightingWgsl.ts'
import { shadedLightScope } from '../blend/shadedLightScope.fixture.ts'
import { waterCompositeShader } from './compositeWgsl.ts'

type Pair = (...args: unknown[]) => { lit: number[]; specular: number[] }
type Sum = (...args: unknown[]) => number[]
const LOBED = waterCompositeShader(false, {})
const PLAIN = waterCompositeShader(false, { lobeless: true })
const SINGLE = `${declaredLightingWgsl({ proxy: 13, transmittance: 18 }, { lobeless: false })}${STANDARD_LIGHTING_WGSL}`
const K = wgslConstants(LOBED)
const SHARED = [
  'directIncidence',
  'rangeWindow',
  'isSun',
  'isSunKind',
  'isRect',
  'modelLight',
  'thinTransmission',
  ...[...STANDARD_LIGHTING_WGSL.matchAll(/fn (\w+)\(/g)].map(([, name]) => name),
]
const LOBE = ['lobeLight', 'anisotropicLobe']
const PAIR = ['sliceLightingPair', 'declaredLightPair', ...SHARED]
const same = (a: number[], b: number[]) => a.every((v, i) => Object.is(v, b[i]))
const unit = (v: number[]) => v.map((x) => x / (Math.hypot(...v) || 1))
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

/** A pixel's lobes as `setLobes` leaves them: a strength along a direction across `N`, a coat. */
function lobesOf(u: (lo: number, hi: number) => number, r: () => number, N: number[], V: number[]) {
  const T = unit(cross(N, Math.abs(N[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]))
  const strength = r() < 0.3 ? 0 : u(0, 1),
    coat = r() < 0.3 ? 0 : u(0, 1)
  const coatN = unit(N.map((n) => n + u(-0.2, 0.2)))
  const facing = Math.max(coatN[0] * V[0] + coatN[1] * V[1] + coatN[2] * V[2], 0)
  const grazing = Math.min(Math.max(1 - facing, 0), 1)
  return { on: true, strength, T, B: cross(N, T), coat, coatRough: u(0.06, 1), coatN, grazing }
}

test('the lobed pair gives the two sums of two lobed walks, its specular on a dielectric', () => {
  const r = random(1483),
    u = (lo: number, hi: number) => lo + (hi - lo) * r()
  let lobed = 0
  for (let round = 0; round < 400; round++) {
    const count = 1 + Math.floor(u(0, 16))
    const P = [u(-5, 5), u(-1, 3), u(-5, 5)]
    const items = [...Array(count).keys()].map((rank) => {
      const kind = [0, K.KIND_SPOT, K.KIND_SUN][rank % 3]
      return {
        positionRange: [P[0] + u(-4, 4), P[1] + u(-4, 4), P[2] + u(-4, 4), u(0.1, 8)],
        colorIntensity: [u(0, 1), u(0, 1), u(0, 1), u(0, 20)],
        directionCone: [u(-0.5, 0.5), -1, u(-0.5, 0.5), kind === K.KIND_SPOT ? 0.7 : -1],
        params: [kind, rank % 2 ? rank : -1, 0, kind === K.KIND_SPOT ? 0.9 : 0],
        shape: [u(0, 0.05), 0, 0, 0],
      }
    })
    const { normal: N, scope: shared } = shadedLightScope(r, u, K, count, items, round)
    const V = [0.6, 0.8, 0]
    const [rgb, metal, rough] = [[u(0, 1), u(0, 1), u(0, 1)], u(0, 1), u(0.06, 1)]
    const scope = {
      ...shared,
      shadowTransmission: [0.9, 0.7, 0.5],
      LightPair: (a: number[], b: number[]) => ({ lit: a, specular: b }),
    }
    const { grazing, ...set } = lobesOf(u, r, N, V)
    const alpha = rough * rough
    const at = alpha + (1 - alpha) * set.strength * set.strength
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    // What `setLobes` shares of them: the surface's own and the null albedo's are each loop's
    // (`lobeSurface`), the coat's is the lobes'.
    const coatAlpha2 = set.coatRough ** 4,
      coatNdotV = Math.max(dot(set.coatN, V), 1e-4)
    const lobes = {
      ...set,
      through: 1 - set.coat * (0.04 + 0.96 * grazing ** 5),
      at,
      ab: alpha,
      invAt: 1 / at,
      invAb: 1 / alpha,
      dScale: 1 / (Math.PI * at * alpha),
      viewLength: Math.hypot(at * dot(set.T, V), alpha * dot(set.B, V), Math.max(dot(N, V), 1e-4)),
      coatSurface: {
        f0: [0.04, 0.04, 0.04],
        diffuse: [0, 0, 0],
        alpha2: coatAlpha2,
        rest: 1 - coatAlpha2,
        NdotV: coatNdotV,
        viewG: Math.sqrt(coatNdotV * coatNdotV * (1 - coatAlpha2) + coatAlpha2),
      },
    }
    const pairOf = (text: string, lobes: object, names: string[]) =>
      shaderRun<{ sliceLightingPair: Pair }>(text, names, { ...scope, lobes }).sliceLightingPair
    const singleOf = (lobes: object) =>
      shaderRun<{ sliceLighting: Sum }>(
        SINGLE,
        ['sliceLighting', 'declaredLight', ...SHARED, ...LOBE],
        {
          ...scope,
          lobes,
        },
      ).sliceLighting
    const ours = pairOf(LOBED, lobes, [...PAIR, ...LOBE])
    const plain = pairOf(PLAIN, {}, PAIR)
    const off = pairOf(LOBED, { on: false }, [...PAIR, ...LOBE])
    const nothing = pairOf(
      LOBED,
      { on: true, strength: 0, coat: 0, coatRough: 0.5, coatN: N, through: 1 },
      [...PAIR, ...LOBE],
    )
    for (const slice of [
      [2, scope.tileLights.length - 2],
      [K.TILE_NO_SLICE, count],
    ]) {
      const args = [rgb, metal, rough, N, V, P, 1, slice]
      const pair = ours(...args)
      const lit = singleOf(lobes)(...args)
      const specular = singleOf(lobes)([0, 0, 0], 0, rough, N, V, P, 1, slice)
      assert.ok(same(pair.lit, lit), `round ${round}: ${pair.lit} against ${lit}`)
      assert.ok(
        same(pair.specular, specular),
        `round ${round}: ${pair.specular} against ${specular}`,
      )
      const theirs = plain(...args)
      for (const without of [off(...args), nothing(...args)]) {
        assert.ok(
          same(without.lit, theirs.lit) && same(without.specular, theirs.specular),
          `${round}`,
        )
      }
      lobed += +(set.strength > 0 && !same(pair.specular, theirs.specular))
    }
  }
  assert.ok(lobed > 50, `${lobed} sums an anisotropic lobe changed`)
})
