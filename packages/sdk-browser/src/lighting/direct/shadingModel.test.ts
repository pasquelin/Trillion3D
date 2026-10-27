// The shading models a graph picks per pixel (`shadingModelWgsl.ts`): the skin reads the imported table at
// the cosine and the opacity, the hair is a finite non-negative term whose multiple scattering
// is shadowed by the light's visibility, and sets no diffuse of the plain pixel; the eye's iris is lit by its own
// normal; a pixel of no model is left as it was.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { SHADING_MODEL_LIGHT_WGSL, SHADING_MODEL_PIXEL_WGSL } from './shadingModelWgsl.ts'
import { PIXEL_MODEL } from '../../materials/surface/pixelModel.ts'
import { SKIN_TABLE_SIZE, skinTableWords } from '../../../../sdk-core/src/lighting/skinTable.ts'

type Fn = (...args: unknown[]) => any
const words = skinTableWords(
  new Uint8Array(readFileSync(new URL('./skinTable.bin', import.meta.url))),
)
const program = wgslModule(SHADING_MODEL_LIGHT_WGSL, SHADING_MODEL_PIXEL_WGSL)
// One profile row: a transmission texel (scattering distribution 0, index of refraction 1) then samples whose red is the sample's
// number over 31.
const TRANSMISSIONS = [
  [0.01, 0.08, 0.5, 1],
  ...Array.from({ length: 32 }, (_, i) => [i / 31, 0, 0, 1]),
]
const run = (state: object) =>
  shaderRun<Record<string, Fn>>(program, ['setPixelModel', 'modelTransmission', 'modelDiffuse'], {
    ...F32_SCOPE,
    surfaceSpecular: 0.5,
    directLights: { skin: words, transmissions: TRANSMISSIONS },
    modelProfile: 0,
    pixelModel: 0,
    sphereNoNewton: false,
    clearCoatBottom: false,
    modelColour: [0, 0, 0],
    modelOpacity: 0,
    modelScatter: 0,
    modelEnvironment: [0, 0, 0],
    irisMask: 0,
    irisCaustic: [0, 0, 1],
    irisNormal: [0, 0, 1],
    ...state,
  })
/** The shadow terms of a light whose shadow is `shade` and whose contact shadow lets everything through. */
const terms = (shade: number) => ({ surface: shade, transmission: shade, thickness: shade })
const srgb = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

test('a skin reads the table at its cosine and opacity, times its subsurface colour', () => {
  // N·L = 0 is the table's column 128.5 of 256, opacity 1 its first row: the centre of the texel (128, 0) is at
  // u = (128 + 0.5) / 256, a cosine of 2u − 1.
  const cosine = 2 * ((128 + 0.5) / SKIN_TABLE_SIZE) - 1
  const at = run({ pixelModel: PIXEL_MODEL.skin, modelColour: [1, 0.5, 0.25], modelOpacity: 1 })
  const term = at.modelTransmission(
    [1, 1, 1],
    0.5,
    [0, 0, 1],
    [0, 0, 1],
    [Math.sqrt(1 - cosine * cosine), 0, cosine],
    [Math.sqrt(1 - cosine * cosine), 0, cosine],
    cosine,
    0,
    terms(1),
    false,
    false,
    1,
  ) as number[]
  const word = words[128]
  const texel = [word & 255, (word >> 8) & 255, (word >> 16) & 255].map((b) => srgb(b / 255))
  ;[1, 0.5, 0.25].forEach((k, c) => assert.ok(Math.abs(term[c] - k * texel[c]) < 1e-4, `${term}`))
  // The indirect diffuse colour adds the subsurface colour.
  const d = at.modelDiffuse([0.5, 0.5, 0.5, 0]) as number[]
  assert.deepEqual(
    d.slice(0, 3).map((x) => Math.round(x * 100) / 100),
    [1.5, 1, 0.75],
  )
})

test('a hair term is finite, never negative, and its multiple scattering follows the light’s visibility', () => {
  const at = run({ pixelModel: PIXEL_MODEL.hair, modelScatter: 1 })
  let lit = 0
  for (let i = 0; i < 200; i++) {
    const a = i * 0.37,
      b = i * 0.91
    const N = [Math.cos(a), Math.sin(a), 0],
      V = [0, Math.cos(b), Math.sin(b)]
    const L = [Math.sin(b), 0, Math.cos(a)]
    const t = at.modelTransmission(
      [0.4, 0.3, 0.2],
      0.4,
      N,
      V,
      L,
      L,
      0.5,
      0,
      terms(1),
      false,
      false,
      1,
    ) as number[]
    assert.ok(
      t.every((x) => Number.isFinite(x) && x >= 0),
      `${t}`,
    )
    if (t.some((x) => x > 0)) lit++
  }
  assert.ok(lit > 150, `${lit} lit directions`)
  const N = [0, 0, 1],
    V = [1, 0, 0],
    L = [0, 1, 0]
  const lit1 = at.modelTransmission(
    [0.4, 0.3, 0.2],
    0.4,
    N,
    V,
    L,
    L,
    0.5,
    0,
    terms(1),
    false,
    false,
    1,
  ) as number[]
  const dark = at.modelTransmission(
    [0.4, 0.3, 0.2],
    0.4,
    N,
    V,
    L,
    L,
    0.5,
    0,
    terms(0),
    false,
    false,
    1,
  ) as number[]
  assert.ok(lit1.every((x, c) => x >= dark[c]))
})

test('a hair’s tint follows the transmission shadow, its multiple scattering the surface shadow', () => {
  const at = run({ pixelModel: PIXEL_MODEL.hair, modelScatter: 1 })
  // The fibre along N, the eye and the light square to it: sin of both angles is 0, where the lobes carry light.
  const N = [0, 0, 1],
    V = [1, 0, 0],
    L = [0, 1, 0]
  const hair = (surface: number, transmission: number) =>
    at.modelTransmission(
      [0.8, 0.3, 0.1],
      0.4,
      N,
      V,
      L,
      L,
      0.6,
      0,
      { surface, transmission, thickness: transmission },
      false,
      false,
      1,
    ) as number[]
  const open = hair(1, 1)
  // The occlusion of a light with no shadow bits is the surface shadow's alone: the scattering lowers.
  const occluded = hair(0.5, 1)
  assert.ok(
    occluded.every((x, c) => x <= open[c]) && occluded.some((x, c) => x < open[c]),
    `${occluded} against ${open}`,
  )
  // Its tint is the transmission shadow's: the same surface shadow under another transmission tints it.
  assert.notDeepEqual(occluded, hair(0.5, 0.5))
  assert.notDeepEqual(hair(1, 0.5), hair(1, 1))
})

test('an eye’s sclera and iris, and a pixel of no model gives nothing', () => {
  const eye = run({
    pixelModel: PIXEL_MODEL.eye,
    irisMask: 1,
    irisCaustic: [0, 0, 1],
    irisNormal: [0, 0, 1],
  })
  const N = [0, 0, 1],
    V = [0, 0, 1]
  const front = eye.modelTransmission(
    [1, 1, 1],
    0.3,
    N,
    V,
    [0, 0, 1],
    [0, 0, 1],
    1,
    0,
    terms(1),
    false,
    false,
    1,
  ) as number[]
  const side = eye.modelTransmission(
    [1, 1, 1],
    0.3,
    N,
    V,
    [1, 0, 0],
    [1, 0, 0],
    0,
    0,
    terms(1),
    false,
    false,
    1,
  ) as number[]
  assert.ok(front[0] > 0 && side[0] === 0, `${front} ${side}`)
  const none = run({}).modelTransmission(
    [1, 1, 1],
    0.3,
    N,
    V,
    [0, 0, 1],
    [0, 0, 1],
    1,
    0,
    terms(1),
    false,
    false,
    1,
  ) as number[]
  assert.deepEqual(none, [0, 0, 0])
  assert.deepEqual(run({}).modelDiffuse([0.2, 0.3, 0.4, 0.5]), [0.2, 0.3, 0.4, 0.5])
})

test('a profile pixel takes the profile at the depth its shadow reads as, and only from a light that transmits', () => {
  const at = run({ pixelModel: PIXEL_MODEL.profile })
  const N = [0, 0, 1],
    V = [0, 0, 1],
    L = [0, 0, -1]
  const term = (shade: number, transmits: boolean) =>
    at.modelTransmission(
      [1, 1, 1],
      0.5,
      N,
      V,
      L,
      L,
      0,
      0,
      terms(shade),
      false,
      transmits,
      1,
    ) as number[]
  // Half shadowed is 2.5 cm of 5: the samples' middle, 15.5 / 31 = 0.5; the phase of an isotropic profile, straight through, is 0.5.
  assert.ok(Math.abs(term(0.5, true)[0] - 0.25) < 1e-5, `${term(0.5, true)}`)
  // Not shadowed there is no depth: the first sample, nothing; wholly shadowed, the last, held at its edge.
  assert.ok(Math.abs(term(1, true)[0]) < 1e-6)
  assert.ok(Math.abs(term(0, true)[0] - 0.5) < 1e-5)
  assert.deepEqual(term(0.5, false), [0, 0, 0])
})

test('a thin subsurface pixel gives the lerp of its transmitted colour and its colour by the shadow, its opacity weighing the wrap', () => {
  const at = run({ modelTransmitDistance: 0.15, modelTransmitted: [0, 0, 0] })
  const N = [0, 0, 1],
    V = [0, 0, 1],
    L = [0, 0, 1]
  at.setPixelModel(PIXEL_MODEL.subsurface, [0.8, 0.4, 0.2, 0], [1, 1, 1, 0], N, V, 0.5, false)
  const term = (shade: number, ao: number) =>
    at.modelTransmission(
      [1, 1, 1],
      0.5,
      N,
      V,
      L,
      L,
      1,
      0,
      terms(shade),
      false,
      false,
      ao,
    ) as number[]
  // Opacity 0, the light behind the eye's line (L·-V = -1): no in-scattering, the back scattering is ao / 2π, whatever the normal.
  assert.ok(Math.abs(term(1, 1)[0] - 0.8 / (2 * Math.PI)) < 1e-5, `${term(1, 1)}`)
  assert.ok(Math.abs(term(1, 0.5)[1] - 0.5 * (0.4 / (2 * Math.PI))) < 1e-5)
  // Shadowed: the transmitted colour keeps the colour's value (its largest channel).
  assert.ok(Math.abs(Math.max(...term(0, 1)) * 2 * Math.PI - 0.8) < 1e-4, `${term(0, 1)}`)
  // The indirect diffuse colour adds the subsurface colour.
  assert.deepEqual(
    (at.modelDiffuse([0.5, 0.5, 0.5, 0]) as number[])
      .slice(0, 3)
      .map((x) => Math.round(x * 100) / 100),
    [1.3, 0.9, 0.7],
  )
})
