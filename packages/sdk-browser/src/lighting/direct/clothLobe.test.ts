// The cloth (`sheenLobeWgsl.ts`, the hooks of `lobesWgsl.ts`): a light's diffuse and specular keep one minus the cloth amount
// times the fuzz's albedo of their light and the fuzz lobe's light is added to it; the cloth's reflectance is masked by its amount;
// the indirect light's diffuse colour keeps the same share and takes the fuzz times the amount and the albedo; the lobes
// target's texel for a cloth holds its fuzz and amount and is told from a coat's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import { NO_SHADING_MODEL } from './shadingModelScope.fixture.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { LOBES_DECODE_WGSL, LOBES_LIGHTING_WGSL } from './lobesWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { lerp } from '../../../../math/src/scalar/reals.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { unitF32 } from '../../../../math/src/vector/unitF32.fixture.ts'

type Fn = (...args: unknown[]) => any
const program = wgslModule(STANDARD_LIGHTING_WGSL, LOBES_LIGHTING_WGSL)
const dot = F32_SCOPE.dot as (a: number[], b: number[]) => number
const ROUND = { on: true, skewed: false, coat: 0, through: 1 }
const run = (lobes: object) =>
  shaderRun<Record<string, Fn>>(
    program,
    ['lobeSurface', 'surfaceLight', 'clothDiffuse', 'indirectKeep', 'setLobes', 'setCloth'],
    { ...F32_SCOPE, ...NO_SHADING_MODEL, lobes },
  )

/** A cloth's sheen view at the normal `N` seen along `V`: the frame of the view (`sheenViewOf`'s) and a transform and albedo of
 *  the test's choosing. */
function sheenOf(N: number[], V: number[]) {
  const nv = dot(N, V)
  const across = unitF32(V.map((x, k) => x - N[k] * nv) as [number, number, number]) as number[]
  const T2 = [
    N[1] * across[2] - N[2] * across[1],
    N[2] * across[0] - N[0] * across[2],
    N[0] * across[1] - N[1] * across[0],
  ]
  return { T1: across, T2, aInv: 1.2, bInv: 0.1, albedo: 0.6 }
}

/** The fuzz lobe of the definition, per unit of the light and before the albedo: the cosine distribution of the direction
 *  moved by the transform times the transform's Jacobian. */
function lobeValue(sheen: ReturnType<typeof sheenOf>, N: number[], L: number[]) {
  const lz = dot(N, L)
  const w = [sheen.aInv * dot(sheen.T1, L) + sheen.bInv * lz, sheen.aInv * dot(sheen.T2, L), lz]
  const jacobian = sheen.aInv / dot(w, w)
  return (w[2] / Math.PI) * jacobian * jacobian
}

test('a cloth keeps one minus its amount times the fuzz albedo of the base lobes and adds the fuzz lobe’s light', () => {
  const r = lcgRandom(1731),
    u = (lo: number, hi: number) => Math.fround(lerp(lo, hi, r()))
  let lit = 0
  for (let round = 0; round < 300; round++) {
    const N = unitF32([u(-1, 1), u(-1, 1), u(0.2, 1)]),
      V = unitF32([u(-1, 1), u(-1, 1), u(0.3, 1)]),
      L = unitF32([u(-1, 1), u(-1, 1), u(0.1, 1)])
    const rough = u(0.15, 1),
      cloth = [0, 1, u(0.1, 0.9)][round % 3],
      fuzz = [u(0, 1), u(0, 1), u(0, 1)],
      energy = u(1, 10),
      sheen = sheenOf(N, V)
    const surface = run(ROUND).lobeSurface([u(0, 1), u(0, 1), u(0, 1)], 0, rough, N, V)
    const light = [...L, energy]
    const plain = run(ROUND).surfaceLight(surface, N, V, light) as number[]
    const cloaked = run({ ...ROUND, cloth, fuzz, sheen }).surfaceLight(
      surface,
      N,
      V,
      light,
    ) as number[]
    const keep = 1 - cloth * sheen.albedo,
      nl = dot(N, L),
      fuzzed = nl > 0 ? energy * sheen.albedo * lobeValue(sheen, N, L) * cloth : 0
    for (let c = 0; c < 3; c++) {
      const expected = plain[c] * keep + fuzz[c] * fuzzed
      assert.ok(
        Math.abs(cloaked[c] - expected) <= 5e-4 * Math.max(Math.abs(expected), 1e-2),
        `round ${round}: ${cloaked[c]} against ${expected}`,
      )
    }
    if (cloth > 0 && nl > 0) lit++
  }
  assert.ok(lit > 100, `${lit} lit cloths`)
})

test('a cloth’s surface has its reflectance masked by its amount and the grazing reflectance of what is left', () => {
  const surface = run(ROUND).lobeSurface([0.5, 0.3, 0.2], 1, 0.4, [0, 0, 1], [0, 0.6, 0.8])
  const { clothSurface } = shaderRun<Record<string, Fn>>(program, ['clothSurface'], {
    ...F32_SCOPE,
    ...NO_SHADING_MODEL,
    lobes: { ...ROUND, cloth: 0.75 },
  })
  const masked = clothSurface(surface)
  ;(surface.f0 as number[]).forEach((x, k) => assert.ok(Math.abs(masked.f0[k] - 0.25 * x) < 1e-6))
  assert.ok(
    Math.abs(masked.f90 - Math.min(Math.max(50 * Math.max(...(masked.f0 as number[])), 0), 1)) <
      1e-6,
  )
  const { clothSurface: plain } = shaderRun<Record<string, Fn>>(program, ['clothSurface'], {
    ...F32_SCOPE,
    ...NO_SHADING_MODEL,
    lobes: { ...ROUND, cloth: 0 },
  })
  assert.deepEqual(plain(surface), surface)
})

test('the indirect light keeps one minus the amount times the fuzz albedo of the diffuse and adds the fuzz, the metal spent', () => {
  const sheen = { T1: [1, 0, 0], T2: [0, 1, 0], aInv: 1, bInv: 0, albedo: 0.6 }
  const lobes = { ...ROUND, cloth: 0.5, fuzz: [0.2, 0.4, 0.6], sheen }
  const albedo = [0.8, 0.6, 0.4]
  const { clothDiffuse, indirectKeep } = run(lobes) as Record<string, Fn>
  const taken = clothDiffuse(albedo, 0.25) as number[]
  ;[0.48, 0.435, 0.39, 0].forEach((x, i) => assert.ok(Math.abs(taken[i] - x) < 1e-6, `${taken}`))
  assert.ok(Math.abs((indirectKeep() as number) - 0.7) < 1e-6)
  const kept = run({ ...ROUND, cloth: 0, fuzz: [1, 1, 1], sheen }).clothDiffuse(
    albedo,
    0.25,
  ) as number[]
  ;[...albedo, 0.25].forEach((x, i) => assert.ok(Math.abs(kept[i] - x) < 1e-6, `${kept}`))
})

test('a cloth texel holds its fuzz and amount, and is told from a coat texel', () => {
  const wgsl = wgslModule(LOBES_DECODE_WGSL)
  const { clothTexel, lobeIsCloth, packedFuzz, packedCloth } = shaderRun<Record<string, Fn>>(
    wgsl,
    ['clothTexel', 'lobeIsCloth', 'packedFuzz', 'packedCloth'],
    F32_SCOPE,
  )
  const texel = clothTexel([0.25, 0.5, 0.75], 0.375)
  assert.equal(lobeIsCloth(texel), true)
  assert.deepEqual(packedFuzz(texel), [0.25, 0.5, 0.75])
  assert.equal(packedCloth(texel), 0.375)
  const coat = [0x3f000000, 0x3f800000, 0x3f800000, Math.fround(0.4)]
  assert.equal(lobeIsCloth(coat), false)
})
