// The toon closure (`toonModelWgsl.ts`): the light's diffuse through the diffuse ramp, its specular through the specular ramp, the shadow's hatching,
// the offset images, the unified diffuse and the peak table, run in JavaScript (`shaderRun`) on the rows the toon buffer holds (`packToonRow`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import { NO_SHADING_MODEL } from './shadingModelScope.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslConstants } from '../../materials/texture/shaderRule.fixture.ts'
import { fromHalf } from '../../../../math/src/float/half.ts'
import {
  resolveToonProfile,
  sampleToonRamps,
} from '../../../../sdk-core/src/lighting/toonProfile/profile.ts'
import {
  TOON_PROFILE_RESOLUTION,
  packToonRow,
  toonLayout,
} from '../../../../sdk-core/src/lighting/toonProfile/rows.ts'
import { ggxMaxSpecWords } from '../../../../sdk-core/src/lighting/ggxMaxSpec.ts'
import { ggxMaxEnergy } from '../../../../sdk-core/src/lighting/ggxMaxSpec.fixture.ts'
import { TOON_APPLY_WGSL, TOON_INDIRECT_WGSL, TOON_LAMP_WGSL } from './toonModelWgsl.ts'

const layout = toonLayout(TOON_PROFILE_RESOLUTION)
const TOON_RAMP_TEXELS = layout.texels
const TOON_PATTERN_WORDS = layout.patternWords
const TOON_ROW_WORDS = layout.rowWords

type Fn<R = any> = (...args: any[]) => R
const PROGRAM = wgslModule(TOON_LAMP_WGSL, TOON_APPLY_WGSL, TOON_INDIRECT_WGSL)
const NAMES = [
  'toonShade',
  'toonLightOut',
  'toonApplyDiffuse',
  'toonPeak',
  'toonPattern',
  'toonIndirectSpecular',
]

// The built-ins the translator lacks: the packed halves and normalised integers.
const unpack2x16float = (word: number) => [fromHalf(word & 0xffff), fromHalf(word >>> 16)]
const unpack2x16unorm = (word: number) => [(word & 0xffff) / 65535, (word >>> 16) / 65535]
const unpack4x8unorm = (word: number) => [0, 8, 16, 24].map((s) => ((word >>> s) & 255) / 255)
const luminance = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

function toon(profile: Parameters<typeof resolveToonProfile>[0] = {}, extra: object = {}) {
  const resolved = resolveToonProfile(profile)
  // The toon buffer's tables, which the tests replace: the rows (the profile's the row 0), the patterns and the peak table.
  const tables = {
    rows: packToonRow(resolved, -1, layout),
    patterns: new Uint32Array(TOON_PATTERN_WORDS),
  }
  const peak = ggxMaxSpecWords()
  const scope: Record<string, unknown> = {
    ...F32_SCOPE,
    ...NO_SHADING_MODEL,
    ...wgslConstants(PROGRAM),
    unpack2x16float,
    unpack2x16unorm,
    unpack4x8unorm,
    luminance,
    tables,
    toonSize: () => TOON_RAMP_TEXELS,
    toonRowWord: (row: number, at: number) => tables.rows[row * TOON_ROW_WORDS + at],
    toonPatternWord: (i: number) => tables.patterns[i],
    toonPeakWord: (i: number) => [peak[i * 2], peak[i * 2 + 1]],
    modelProfile: 0,
    modelToonUv: [0.3, 0.6],
    toonUnified: false,
    toonQuantize: false,
    toonDiffuse: [0, 0, 0],
    toonWeight: 0,
    toonWeightedNoL: 0,
    ...extra,
  }
  return { fns: shaderRun<Record<string, Fn>>(PROGRAM, NAMES, scope), scope, resolved, tables }
}
const surface = { diffuse: [0.5, 0.25, 0.1], f0: [0.8, 0.4, 0.2] }
const near = (got: number[], want: number[], e = 2e-3) =>
  want.forEach((w, i) => assert.ok(Math.abs(got[i] - w) <= e, `${got} against ${want}`))
/** The ramp read at `x` as a texture of its texels is by a bilinear filter that clamps at the edge. */
function rampAt(
  resolved: ReturnType<typeof resolveToonProfile>,
  ramp: 'diffuse' | 'specular',
  x: number,
) {
  const p = Math.min(Math.max(x * TOON_RAMP_TEXELS - 0.5, 0), TOON_RAMP_TEXELS - 1),
    i = Math.floor(p),
    j = Math.min(i + 1, TOON_RAMP_TEXELS - 1)
  const a = texel(resolved, ramp, i),
    b = texel(resolved, ramp, j)
  return a.map((v, c) => v + (b[c] - v) * (p - i))
}
const texel = (
  resolved: ReturnType<typeof resolveToonProfile>,
  ramp: 'diffuse' | 'specular',
  i: number,
) => Array.from(sampleToonRamps(resolved, TOON_RAMP_TEXELS)[ramp].subarray(i * 3, i * 3 + 3))

test('the diffuse goes through the diffuse ramp at the cosine remapped to [0, 1], times the colour and the energy', () => {
  const { fns, resolved } = toon()
  // A light facing the normal reads the last texel; one behind it the first.
  const facing = fns.toonShade(surface, 0, 1, 1, 2, 1, 1)
  const ramp = texel(resolved, 'diffuse', 63)
  near(
    facing.diffuse,
    surface.diffuse.map((d, c) => d * 2 * ramp[c]),
  )
  near(fns.toonShade(surface, 0, -1, 0, 2, 1, 1).diffuse, [0, 0, 0])
  // The middle of a band: N·L = 0.1, 0.55 into the remapped range, the third texel row of the 0.51 to 0.75 band.
  const band = texel(resolved, 'diffuse', 35)
  near(
    fns.toonShade(surface, 0, 0.1, 0.1, 1, 1, 1).diffuse,
    surface.diffuse.map((d, c) => d * band[c]),
  )
})

test('the transmittance multiplies the diffuse, or joins the ramp’s input where the profile includes the shadow', () => {
  const plain = toon().fns
  const full = plain.toonShade(surface, 0, 1, 1, 1, 1, 1).diffuse
  near(
    plain.toonShade(surface, 0, 1, 1, 1, 1, 0.5).diffuse,
    full.map((v: number) => v * 0.5),
  )
  const included = toon({ diffuseRampIncludesShadow: true }).fns
  // The cosine 1 times a transmittance of 0.5 reads the ramp at 0.5, whole, not halved.
  const half = rampAt(resolveToonProfile({}), 'diffuse', 0.5)
  near(
    included.toonShade(surface, 0, 1, 1, 1, 1, 0.5).diffuse,
    surface.diffuse.map((d, c) => d * half[c]),
  )
  assert.equal(included.toonShade(surface, 0, 1, 1, 1, 1, 0).weight, 0)
})

test('the specular goes through the specular ramp, times the colour, the surface shadow, the cosine and the energy', () => {
  const { fns } = toon()
  near(
    fns.toonShade(surface, 0.9, 0.5, 0.5, 2, 0.5, 1).specular,
    surface.f0.map((f) => f * 0.5 * 0.5 * 2),
  )
  near(fns.toonShade(surface, 0.2, 0.5, 0.5, 2, 0.5, 1).specular, [0, 0, 0])
})

test('the unified diffuse leaves the ramp out, the weight the transmittance times the energy and the remapped cosine', () => {
  const { fns } = toon({}, { toonUnified: true })
  const lit = fns.toonShade(surface, 0, 0.5, 0.5, 2, 1, 0.5)
  near(
    lit.diffuse,
    surface.diffuse.map((d) => d * 2 * 0.5),
  )
  assert.ok(Math.abs(lit.weight - 1) < 1e-6)
  assert.ok(Math.abs(lit.shadowNoL - 0.75) < 1e-6)
})

test('a light adds its toon light to the pixel, or with the unified diffuse its specular alone and its diffuse to the sum', () => {
  const sample = { diffuse: [1, 2, 3], specular: [0.1, 0.1, 0.1], weight: 2, shadowNoL: 0.25 }
  near(toon().fns.toonLightOut(sample, [0.5, 1], [1, 1, 1]), [0.6, 1.1, 1.6])
  // Two lights, then the sum: the diffuse added unramped (by its share), the weights by the luminance of the light's colour (not by the diffuse share), the cosines weighted.
  const probe = shaderRun<Record<string, Fn>>(
    wgslModule(
      wgslBlock(
        'probe',
        [TOON_LAMP_WGSL, TOON_APPLY_WGSL],
        'fn probeSum(a:ToonSample,b:ToonSample)->vec3f{toonUnified=true;let x=toonLightOut(a,vec2f(0.5,1.0),vec3f(1.0));let y=toonLightOut(b,vec2f(1.0,1.0),vec3f(0.5));return toonApplyDiffuse(toonDiffuse,vec2f(toonWeight,toonWeightedNoL))+x+y;}',
      ),
    ),
    ['probeSum'],
    toon().scope,
  )
  const other = { diffuse: [2, 2, 2], specular: [0, 0, 0], weight: 1, shadowNoL: 1 }
  const w1 = 2 * luminance([1, 1, 1]),
    w2 = 1 * luminance([0.5, 0.5, 0.5])
  const mean = (w1 * 0.25 + w2 * 1) / (w1 + w2)
  const ramp = rampAt(resolveToonProfile({}), 'diffuse', mean)
  const sum = [0.5 * 1 + 1, 0.5 * 2 + 1, 0.5 * 3 + 1]
  near(
    probe.probeSum(sample, other),
    sum.map((v, c) => v * ramp[c] + 0.1),
  )
})

test('the diffuse applied once reads the ramp at the weighted mean cosine, of the sum', () => {
  const { fns, resolved } = toon()
  // Two lights of equal weight, at remapped cosines 1 and 0: the mean 0.5.
  const ramp = rampAt(resolved, 'diffuse', 0.5)
  near(
    fns.toonApplyDiffuse([2, 1, 0.5], [2, 1]),
    [2, 1, 0.5].map((d, c) => d * ramp[c]),
  )
  near(fns.toonApplyDiffuse([2, 1, 0.5], [0, 0]), [0, 0, 0])
})

test('the peak table is read as the CPU twin reads it, bilinear across roughness and anisotropy', () => {
  const { fns } = toon()
  for (const [rough, aniso, noV] of [
    [0.5, 0, 1],
    [0.3, 0.4, 0.5],
    [0.9, 0.7, 0.2],
  ])
    assert.ok(
      Math.abs(fns.toonPeak(rough, aniso, noV) - ggxMaxEnergy(rough, aniso, noV)) < 1e-3,
      `${rough} ${aniso} ${noV}`,
    )
})

test('an offset image moves the diffuse ramp’s input by its strength times its grey level remapped to [-1, 1]', () => {
  const profile = {
    diffuseRampOffsetTexture: { isTexture: true, id: 't', version: 0 } as never,
    diffuseRampOffsetStrength: 0.25,
  }
  const resolved = resolveToonProfile(profile)
  const row = packToonRow(resolved, 0, layout)
  const patterns = new Uint32Array(TOON_PATTERN_WORDS)
  // The whole image white in the diffuse channel: an offset of +0.25.
  for (let i = 0; i < TOON_RAMP_TEXELS * TOON_RAMP_TEXELS; i++) patterns[i] = 0x0000ffff
  const { fns, tables } = toon({}, {})
  tables.rows = row
  tables.patterns = patterns
  // A cosine of 0.5 remapped to 0.75, plus 0.25: the last texel.
  const last = texel(resolveToonProfile({}), 'diffuse', 63)
  near(
    fns.toonShade(surface, 0, 0.5, 0.5, 1, 1, 1).diffuse,
    surface.diffuse.map((d, c) => d * last[c]),
  )
  assert.equal(row.length, TOON_ROW_WORDS)
})

test('the shadow is drawn with the hatching: its channels blended along the distribution ramp, faded to white by the strength', () => {
  const texture = { isTexture: true, id: 'h', version: 0 } as never
  const resolved = resolveToonProfile({
    shadowHatchingPatternTexture: texture,
    shadowHatchingPatternStrength: 0.5,
  })
  const patterns = new Uint32Array(TOON_PATTERN_WORDS)
  // Red 0.2 (51), green 0, blue 0, alpha 0 everywhere.
  for (let i = 0; i < TOON_RAMP_TEXELS * TOON_RAMP_TEXELS; i++)
    patterns[TOON_PATTERN_WORDS / 2 + i] = 51
  const { fns, tables } = toon()
  tables.rows = packToonRow(resolved, 0, layout)
  tables.patterns = patterns
  const full = fns.toonShade(surface, 0, 1, 1, 1, 1, 1)
  // The distribution ramp is the identity: a transmittance of 1 reads 0.992, mostly white; of 0.6 it blends green and red.
  const ramp = (x: number) => Math.min(Math.max(x * 64 - 0.5, 0), 63) + 0.5
  const d1 = ramp(1) / 64
  const hatch1 = 0.2 + (1 - 0.2) * Math.min(Math.max((d1 - 0.75) / 0.25, 0), 1)
  const t1 = 1 + (hatch1 - 1) * 0.5
  assert.ok(Math.abs(full.weight - t1) < 2e-3, `weight ${full.weight} against ${t1}`)
  const d6 = ramp(0.6) / 64
  const hatch6 = 0 + (0.2 - 0) * Math.min(Math.max((d6 - 0.5) / 0.25, 0), 1)
  const t6 = 1 + (hatch6 - 1) * 0.5
  assert.ok(Math.abs(fns.toonShade(surface, 0, 1, 1, 1, 1, 0.6).weight - t6) < 3e-3)
  // Without an image the transmittance is the light's, whatever the strength.
  assert.ok(Math.abs(toon().fns.toonShade(surface, 0, 1, 1, 1, 1, 0.6).weight - 0.6) < 1e-6)
})

test('the specular indirect light is scaled by the profile, and quantised by its ramp where the setting and the repetition say', () => {
  const light = [0.5, 0.25, 0.125]
  near(toon({ specularIndirectScale: 0.5 }).fns.toonIndirectSpecular(light), [0.25, 0.125, 0.0625])
  // No repetition, or the setting off: the scaled light as it is.
  near(toon({ specularIndirectRampRepetition: 4 }).fns.toonIndirectSpecular(light), light)
  near(toon({}, { toonQuantize: true }).fns.toonIndirectSpecular(light), light)
  // A repetition of 1 with the default ramp (the identity) gives the light back; a stepped ramp snaps the value to a level.
  const identity = toon({ specularIndirectRampRepetition: 1 }, { toonQuantize: true })
  near(identity.fns.toonIndirectSpecular(light), light, 2e-2)
  const stepped = toon(
    {
      specularIndirectRampRepetition: 1,
      specularIndirectRamp: [
        [0, 0.5],
        [1, 0.5],
      ],
    },
    { toonQuantize: true },
  ).fns.toonIndirectSpecular(light)
  // The largest channel's logarithm is its value: its fraction is replaced by 0.5.
  const value = Math.log(light[0])
  const snapped = Math.exp(value - (value - Math.floor(value)) + 0.5)
  assert.ok(Math.abs(stepped[0] - snapped) < 1e-2, `${stepped[0]} against ${snapped}`)
})
