// The rough diffuse (`lobeDiffuse`, `diffuseEon`, `standardLighting.ts`): the energy-preserving diffuse of a new project, taken at the
// light's cosine and its direction to the view, at the surface's roughness times the source's weight times 0.4. Its values are checked
// beside the formula written out from the paper's terms (in double precision, apart from the shader's), at several roughnesses, albedos and
// angles; a source past 20 cm stays Lambert, and the switch off gives the old Lambert bit for bit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import { NO_SHADING_MODEL } from './shadingModelScope.fixture.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { LOBES_LIGHTING_WGSL } from './lobesWgsl.ts'
import { DIRECT_LIGHT_WGSL } from './lightWgsl.ts'
import { wgslConstants } from '../../materials/texture/shaderRule.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { createSceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'
import { LIGHT_FIELD, baseOf } from '../../../../sdk-core/src/scene/light/fields.ts'
import { unitF32 } from '../../../../math/src/vector/unitF32.fixture.ts'

type Fn<R = number[]> = (...args: unknown[]) => R
const SCOPE = { ...F32_SCOPE, ...NO_SHADING_MODEL }
const PROGRAM = wgslModule(DIRECT_LIGHT_WGSL, STANDARD_LIGHTING_WGSL, LOBES_LIGHTING_WGSL)
const NAMES = [
  'lobeSurface',
  'lobeDiffuse',
  'diffuseEon',
  'withoutDiffuse',
  'surfaceLight',
  'capsuleLook',
]
const run = (roughDiffuse: boolean) =>
  shaderRun<Record<string, Fn<any>>>(PROGRAM, NAMES, {
    ...SCOPE,
    ...wgslConstants(PROGRAM),
    directLights: { items: [] },
    roughDiffuse,
    lobes: { on: false, skewed: false, coat: 0, cloth: 0 },
  })

/** The formula written out from its terms, in double precision: the diffuse colour `c` (a channel), the roughness `r` (already weighed). */
function eon(c: number, r: number, NoV: number, NoL: number, VoL: number) {
  const rho = c * (1 + (0.189468 - 0.189468 * c) * r)
  const S = VoL - NoV * NoL
  const SOverT = Math.max(S / Math.max(1e-6, Math.max(NoV, NoL)), S)
  const AF = 1 - r * (1 - 1 / (1 + (0.5 - 2 / (3 * Math.PI))))
  const fss = AF * (1 + r * SOverT)
  const fms = 1 - AF * (1 + r * (0.262048 - 0.262048 * NoV))
  return (rho * (fss + rho * fms)) / Math.PI
}
const near = (got: number[], want: number[], what: string) =>
  want.forEach((w, i) =>
    assert.ok(Math.abs(got[i] - w) <= 2e-6 + 1e-5 * Math.abs(w), `${what}: ${got} against ${want}`),
  )

test('the rough diffuse is the paper’s formula at the roughness times the weight times 0.4, over several roughnesses, albedos and angles', () => {
  const on = run(true)
  const N = [0, 0, 1]
  for (const rough of [0.05, 0.3, 0.6, 1])
    for (const albedo of [
      [0.8, 0.4, 0.1],
      [1, 1, 1],
      [0.05, 0.5, 0.95],
    ])
      for (const [NoV, NoL, VoL] of [
        [1, 1, 1],
        [0.8, 0.5, 0.2],
        [0.3, 0.9, -0.4],
        [0.1, 0.1, 0.95],
        [0.6, 0.02, -0.9],
      ]) {
        const V = unitF32([Math.sqrt(1 - NoV * NoV), 0, NoV])
        const s = on.lobeSurface(albedo, 0, rough, N, V)
        const got = on.lobeDiffuse(s, NoL, VoL, 1)
        const want = albedo.map((c) => eon(c, 0.4 * rough, Math.fround(s.diffuseNdotV), NoL, VoL))
        near(got, want, `rough ${rough} albedo ${albedo} at ${[NoV, NoL, VoL]}`)
      }
})

test('the weight of the source scales the roughness: half the weight, half the roughness; none, Lambert’s', () => {
  const on = run(true)
  const N = [0, 0, 1],
    V = unitF32([0.6, 0, 0.8])
  const s = on.lobeSurface([0.7, 0.5, 0.3], 0, 0.8, N, V)
  const at = (micro: number) => on.lobeDiffuse(s, 0.7, 0.3, micro)
  near(
    at(0.5),
    [0.7, 0.5, 0.3].map((c) => eon(c, 0.2 * 0.8 * 1, Math.fround(s.diffuseNdotV), 0.7, 0.3)),
    'half',
  )
  assert.deepEqual(at(0), s.diffuse, 'no weight: Lambert’s, bit for bit')
  assert.deepEqual(at(-1), s.diffuse)
})

test('the switch off gives Lambert’s diffuse bit for bit, in the light’s term as in the colour', () => {
  const off = run(false),
    on = run(true)
  const N = [0, 0, 1],
    V = unitF32([0.6, 0, 0.8]),
    L = unitF32([-0.4, 0.2, 0.9])
  const s = off.lobeSurface([0.7, 0.5, 0.3], 0, 0.9, N, V)
  assert.deepEqual(off.lobeDiffuse(s, 0.9, 0.1, 1), s.diffuse)
  const withEon = on.surfaceLight(s, N, V, [...L, 2])
  const lambert = off.surfaceLight(s, N, V, [...L, 2])
  // The specular is the same: only the diffuse differs, by the difference of the two diffuse colours times the light’s direct share.
  const NdotL = Math.fround(L[2])
  const VdotH = (() => {
    const h = unitF32([L[0] + V[0], L[1] + V[1], L[2] + V[2]])
    return Math.max(0, V[0] * h[0] + V[1] * h[1] + V[2] * h[2])
  })()
  const diffuse = on.lobeDiffuse(s, NdotL, 2 * VdotH * VdotH - 1, 1)
  withEon.forEach((v: number, i: number) =>
    assert.ok(
      Math.abs(v - lambert[i] - (diffuse[i] - s.diffuse[i]) * 2 * NdotL) <=
        1e-5 * Math.max(1, Math.abs(v)),
      `${i}: ${v} against ${lambert[i]}`,
    ),
  )
  assert.notDeepEqual(withEon, lambert, 'the switch on moves the light’s term')
})

test('a source of size takes less of it: 1 for none, 0.5 at 10 cm, none from 20 cm, by the greater of its radius and its length', () => {
  const area = run(true)
  const N = [0, 0, 1],
    V = unitF32([0.6, 0, 0.8])
  // The weight is written with the light (`LIGHT_FIELD.sourceTerm`, from its radius and its length) and handed to the look.
  const micro = (radius: number, halfLength: number) => {
    const store = createSceneLightStore()
    store.add({
      id: 'lamp',
      kind: 'point',
      position: [0, 0, 0],
      color: [1, 1, 1],
      intensity: 1,
      range: 10,
      castsShadow: false,
      // A source of no size declares none: the contract refuses a radius or a length of 0.
      ...(radius > 0 && { emitterRadius: radius }),
      ...(halfLength > 0 && { emitterLength: 2 * halfLength }), // the declared length is the whole tube's
    })
    const weight = store.packed[baseOf(store.slotOf('lamp')) + LIGHT_FIELD.sourceTerm]
    return area.capsuleLook([0, 0, 2], [halfLength, 0, 0], radius, 0, weight, N, V).micro
  }
  assert.equal(micro(0, 0), 1)
  near([micro(0.1, 0)], [0.5], 'a sphere of 10 cm')
  near([micro(0, 0.05)], [0.5], 'a tube of 10 cm')
  near([micro(0.04, 0.05)], [0.5], 'the greater of the two')
  assert.equal(micro(0.2, 0), 0)
  assert.equal(micro(0, 0.3), 0)
})

test('the pixel’s terms taken once give the full formula; a surface without diffuse light holds none, whatever the source', () => {
  const on = run(true)
  const N = [0, 0, 1],
    V = unitF32([0.6, 0, 0.8])
  const s = on.lobeSurface([0.7, 0.5, 0.3], 0, 0.8, N, V)
  for (const [NoL, VoL] of [
    [0.7, 0.3],
    [0.2, -0.6],
    [1, 1],
  ]) {
    const cached = on.lobeDiffuse(s, NoL, VoL, 1)
    const full = on.diffuseEon(
      s.diffuse.map((c: number) => c * Math.PI),
      0.4 * Math.sqrt(s.alpha),
      s.diffuseNdotV,
      NoL,
      VoL,
    )
    near(cached, full, `cos ${NoL}, ${VoL}`)
  }
  const bare = on.withoutDiffuse(s)
  for (const micro of [1, 0.5])
    assert.deepEqual(
      on.lobeDiffuse(bare, 0.7, 0.3, micro),
      [0, 0, 0],
      `no diffuse at the weight ${micro}`,
    )
})
