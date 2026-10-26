// The cloth lobe (`clothWgsl.ts`, the hooks of `lobesWgsl.ts`): a light's specular is the standard
// lobe's where the cloth amount is zero, the fuzz lobe's (the inverse GGX distribution, its
// visibility and Schlick's Fresnel on the fuzz colour) where it is one, the mix between; the
// diffuse is Lambert's whatever the amount; the indirect light's diffuse colour takes the fuzz
// times the amount; the lobes target's texel for a cloth holds its fuzz and amount and is told
// from a coat's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
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
    ['lobeSurface', 'surfaceLight', 'clothDiffuse', 'setLobes', 'setCloth'],
    { ...F32_SCOPE, lobes, pixelModel: 0, sphereNoNewton: false, clearCoatBottom: false },
  )

test('a cloth mixes the standard specular with the fuzz lobe by its amount and keeps the diffuse', () => {
  const r = lcgRandom(1731),
    u = (lo: number, hi: number) => Math.fround(lerp(lo, hi, r()))
  let mixed = 0
  for (let round = 0; round < 300; round++) {
    const N = unitF32([u(-1, 1), u(-1, 1), u(0.2, 1)]),
      V = unitF32([u(-1, 1), u(-1, 1), u(0.3, 1)]),
      L = unitF32([u(-1, 1), u(-1, 1), u(0.1, 1)])
    const rough = u(0.15, 1),
      cloth = [0, 1, u(0.1, 0.9)][round % 3],
      fuzz = [u(0, 1), u(0, 1), u(0, 1)],
      energy = u(1, 10)
    const surface = run(ROUND).lobeSurface([u(0, 1), u(0, 1), u(0, 1)], 0, rough, N, V)
    const light = [...L, energy]
    const plain = run(ROUND).surfaceLight(surface, N, V, light) as number[]
    const cloaked = run({ ...ROUND, cloth, fuzz }).surfaceLight(surface, N, V, light) as number[]
    const nl = Math.max(dot(N, L), 0),
      direct = energy * nl,
      H = unitF32([L[0] + V[0], L[1] + V[1], L[2] + V[2]]),
      nh = Math.max(dot(N, H), 0),
      vh = Math.max(dot(V, H), 0),
      nv = Math.max(dot(N, V), 1e-4),
      a2 = rough ** 4,
      d = (nh - a2 * nh) * nh + a2,
      D = (1 + (4 * a2 * a2) / (d * d)) / (Math.PI * (1 + 4 * a2)),
      vis = 1 / (4 * (nl + nv - nl * nv)),
      fc = (1 - vh) ** 5
    for (let c = 0; c < 3; c++) {
      const f90 = Math.min(Math.max(50 * fuzz[1], 0), 1)
      const fuzzSpec = direct * D * vis * (f90 * fc + (1 - fc) * fuzz[c])
      const diffuse = (surface.diffuse as number[])[c] * direct
      const expected = diffuse + (1 - cloth) * (plain[c] - diffuse) + cloth * fuzzSpec
      assert.ok(
        Math.abs(cloaked[c] - expected) <= 2e-4 * Math.max(Math.abs(expected), 1e-2),
        `round ${round}: ${cloaked[c]} against ${expected}`,
      )
    }
    if (cloth > 0 && nl > 0) mixed++
  }
  assert.ok(mixed > 100, `${mixed} lit cloths`)
})

test('the indirect light takes the fuzz times the cloth amount on the diffuse colour, the metal spent', () => {
  const lobes = { ...ROUND, cloth: 0.5, fuzz: [0.2, 0.4, 0.6] }
  const albedo = [0.8, 0.6, 0.4]
  const { clothDiffuse } = run(lobes)
  const taken = clothDiffuse(albedo, 0.25) as number[]
  ;[0.7, 0.65, 0.6, 0].forEach((x, i) => assert.ok(Math.abs(taken[i] - x) < 1e-6, `${taken}`))
  const kept = run({ ...ROUND, cloth: 0, fuzz: [1, 1, 1] }).clothDiffuse(albedo, 0.25) as number[]
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
