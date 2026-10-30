import { clamp } from '../../../../math/src/scalar/reals.ts'
import type { Texture } from '../../world/texture/texture.ts'

/**
 * A toon profile: what the toon shading of a material reads beside the material's own values — the ramps that turn the light into
 * bands, the patterns that offset the ramps, the shadow's hatching and how much of the diffuse indirect light the surface keeps. Colours are
 * linear RGB.
 */

/** A key of a ramp: the position along it, in [0, 1], and the value there — a number for a grey, three numbers for a colour. */
export type ToonColourKey = readonly [
  time: number,
  value: number | readonly [number, number, number],
]
/** A key of a curve: the position along it, in [0, 1], and its value there. */
export type ToonCurveKey = readonly [time: number, value: number]

export interface ToonProfile {
  /** The diffuse ramp over the cosine of the normal with the light, remapped from [-1, 1] to [0, 1]; between its keys it is linear, before the first and after the last the key's value. */
  diffuseRamp: readonly ToonColourKey[]
  /** An image whose grey level, remapped to [-1, 1], offsets the diffuse ramp's input along the surface (a distance field is recommended); none: no offset. */
  diffuseRampOffsetTexture: Texture | null
  /** How strongly the offset image moves the diffuse ramp's input, 0 and up. */
  diffuseRampOffsetStrength: number
  /** How many times the offset image repeats over the surface's pattern coordinates, 1 and up. */
  diffuseRampOffsetSize: number
  /** The specular ramp over the lobe's value, in [0, 1], times the specular colour. */
  specularRamp: readonly ToonColourKey[]
  /** An image whose grey level, remapped to [-1, 1], offsets the specular ramp's input; none: no offset. */
  specularRampOffsetTexture: Texture | null
  /** How strongly the offset image moves the specular ramp's input, 0 and up. */
  specularRampOffsetStrength: number
  /** How many times the offset image repeats over the surface's pattern coordinates, 1 and up. */
  specularRampOffsetSize: number
  /** How the four channels of the hatching image are spread along the shadow, the shadow in, the weight out, both in [0, 1]: 1 is white, 0.75 the red channel, 0.5 the green, 0.25 the blue, 0 the alpha. */
  shadowHatchingPatternDistributionRamp: readonly ToonCurveKey[]
  /** The hatching image the shadow is drawn with: its red channel next to the lit surface, then green, blue and alpha as the shadow darkens; none: a plain shadow. */
  shadowHatchingPatternTexture: Texture | null
  /** How many times the hatching image repeats over the surface's pattern coordinates, 1 and up. */
  shadowHatchingPatternSize: number
  /** The strength of the hatching, 0 (a plain shadow) and up. */
  shadowHatchingPatternStrength: number
  /** How deep light goes into the surface for the shadow maps' occluder distance: the extinction, per metre, 0 to 100, of the medium the surface stands for — a value of 1 leaves 36% of the light after a metre. */
  shadowExtinctionCoefficient: number
  /** The scale of the diffuse indirect light, 0 and up. */
  diffuseIndirectScale: number
  /** The scale of the specular indirect light (the reflections), 0 and up. */
  specularIndirectScale: number
  /** The ramp that quantises the specular indirect light over the fraction of its repeated luminance, both in [0, 1]; used where the setting `toonReflectionQuantization` is on and the repetition above 0. */
  specularIndirectRamp: readonly ToonCurveKey[]
  /** How many times the specular indirect ramp repeats over the range of luminance; 0: the ramp is not applied. */
  specularIndirectRampRepetition: number
  /** Whether the shadow joins the diffuse ramp's input (the cosine times the transmittance) instead of multiplying its result. */
  diffuseRampIncludesShadow: boolean
}

/** What a page may pass for a toon profile: any of its fields, the others the default profile's. */
export type ToonProfileInput = Partial<ToonProfile>

/** The default profile: four bands of diffuse, a hard specular at the middle of the lobe, a shadow with no hatching. */
const DEFAULT_TOON_PROFILE: Readonly<ToonProfile> = {
  diffuseRamp: [
    [0, 0],
    [0.25, 0],
    [0.26, 0.25],
    [0.5, 0.25],
    [0.51, 0.5],
    [0.75, 0.5],
    [0.76, 0.75],
    [0.99, 0.75],
    [1, 1],
  ],
  diffuseRampOffsetTexture: null,
  diffuseRampOffsetStrength: 0,
  diffuseRampOffsetSize: 1,
  specularRamp: [
    [0, 0],
    [0.5, 0],
    [0.51, 1],
    [1, 1],
  ],
  specularRampOffsetTexture: null,
  specularRampOffsetStrength: 0,
  specularRampOffsetSize: 1,
  shadowHatchingPatternDistributionRamp: [
    [0, 0],
    [1, 1],
  ],
  shadowHatchingPatternTexture: null,
  shadowHatchingPatternSize: 1,
  shadowHatchingPatternStrength: 1,
  shadowExtinctionCoefficient: 10,
  diffuseIndirectScale: 1,
  specularIndirectScale: 1,
  specularIndirectRamp: [
    [0, 0],
    [1, 1],
  ],
  specularIndirectRampRepetition: 0,
  diffuseRampIncludesShadow: false,
}

/** The range of each number of a profile, both ends included (`Infinity`: no upper end). */
const RANGES = {
  diffuseRampOffsetStrength: [0, Infinity],
  diffuseRampOffsetSize: [1, Infinity],
  specularRampOffsetStrength: [0, Infinity],
  specularRampOffsetSize: [1, Infinity],
  shadowHatchingPatternSize: [1, Infinity],
  shadowHatchingPatternStrength: [0, Infinity],
  shadowExtinctionCoefficient: [0, 100],
  diffuseIndirectScale: [0, Infinity],
  specularIndirectScale: [0, Infinity],
  specularIndirectRampRepetition: [0, Infinity],
} as const satisfies Partial<Record<keyof ToonProfile, readonly [number, number]>>

const isTexture = (value: unknown): value is Texture =>
  typeof value === 'object' && value !== null && (value as Texture).isTexture === true

const isKey = (key: unknown, colour: boolean): key is ToonColourKey =>
  Array.isArray(key) &&
  key.length === 2 &&
  Number.isFinite(key[0]) &&
  (colour && Array.isArray(key[1])
    ? key[1].length === 3 && key[1].every(Number.isFinite)
    : Number.isFinite(key[1]))

/** The keys `value` holds if it is a list of one key or more of the right kind, in order of time, else `undefined`. */
function sortedKeys<K extends ToonColourKey | ToonCurveKey>(value: unknown, colour: boolean) {
  if (!Array.isArray(value) || value.length === 0 || !value.every((key) => isKey(key, colour)))
    return undefined
  return (value as K[]).map((key) => [key[0], key[1]] as unknown as K).sort((a, b) => a[0] - b[0])
}

/**
 * `input` as a whole profile: each field it gives of the right kind, held to its range, the default profile's for the others and
 * for a field of another kind (a number for a number, a list of `[time, value]` keys for a ramp, a texture or `null` for an image, a
 * switch for a switch). The ramps are copied, sorted by time.
 */
export function resolveToonProfile(input: ToonProfileInput): ToonProfile {
  const given = input as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, fallback] of Object.entries(DEFAULT_TOON_PROFILE)) {
    const value = given[key]
    const range = (RANGES as Record<string, readonly [number, number]>)[key]
    if (range)
      out[key] = Number.isFinite(value) ? clamp(value as number, range[0], range[1]) : fallback
    else if (key.endsWith('Texture')) out[key] = isTexture(value) ? value : null
    else if (typeof fallback === 'boolean') out[key] = typeof value === 'boolean' ? value : fallback
    else
      out[key] =
        sortedKeys(value, key === 'diffuseRamp' || key === 'specularRamp') ??
        structuredClone(fallback)
  }
  return out as unknown as ToonProfile
}

/** The value of the keys `keys` at `time`: linear between two keys, the first key's value before it and the last's after. */
function evaluate(keys: readonly ToonCurveKey[], time: number) {
  const first = keys[0]!,
    last = keys[keys.length - 1]!
  if (time <= first[0]) return first[1]
  if (time >= last[0]) return last[1]
  let at = 1
  while (keys[at]![0] < time) at++
  const [t0, v0] = keys[at - 1]!,
    [t1, v1] = keys[at]!
  return t1 > t0 ? v0 + ((v1 - v0) * (time - t0)) / (t1 - t0) : v1
}

/** The ramp `keys` at `time` as three channels (a grey key is the same in each). */
function toonRampAt(keys: readonly ToonColourKey[], time: number): [number, number, number] {
  const channel = (c: number) =>
    evaluate(
      keys.map(([t, v]) => [t, typeof v === 'number' ? v : v[c]!] as ToonCurveKey),
      time,
    )
  return [channel(0), channel(1), channel(2)]
}

/** The curve `keys` at `time`. */
const toonCurveAt = (keys: readonly ToonCurveKey[], time: number) => evaluate(keys, time)

/**
 * The ramps of a profile sampled at the centres of `count` texels, `(i + 0.5) / count` — the table the lights read: the diffuse and
 * specular ramps three channels a texel, the shadow's distribution and the specular indirect ramp one.
 */
export function sampleToonRamps(profile: ToonProfile, count: number) {
  const diffuse = new Float32Array(count * 3),
    specular = new Float32Array(count * 3),
    shadow = new Float32Array(count),
    indirect = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const time = (i + 0.5) / count
    diffuse.set(toonRampAt(profile.diffuseRamp, time), i * 3)
    specular.set(toonRampAt(profile.specularRamp, time), i * 3)
    shadow[i] = toonCurveAt(profile.shadowHatchingPatternDistributionRamp, time)
    indirect[i] = toonCurveAt(profile.specularIndirectRamp, time)
  }
  return { diffuse, specular, shadow, indirect }
}
