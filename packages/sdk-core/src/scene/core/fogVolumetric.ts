/**
 * THE FOG'S VOLUME: light that crosses the fog is scattered by it, in beams where a shadow cuts a
 * light, and in the colour of every light that reaches it.
 *
 * Off by default, as it is in the engines that fixed its numbers: `volumetric: true` turns it on
 * with every field at its default, an object turns it on with the fields it names. The medium is
 * the height fog's own — its density, its falloff and its second layer, halved: the volume reads
 * density as an extinction where the analytic fog reads it as the exponent of two — scaled by
 * `densityScale`. Each cell of a grid over the screen and the distance, a froxel, holds the
 * light scattered toward the eye (`packages/sdk-browser/src/lighting/fog/`), the cells are summed
 * front to back, and a surface reads the sum at its pixel and its depth. The grid's resolution is
 * the run-time quality (`volumetricFogQuality`, `../../contracts/volumetricFogOptions.ts`), not the
 * scene's. The analytic fog starts where the volume ends: `reach` past `startAt` from the
 * eye along the view, and the volume ignores the fog's own start distance, maximum opacity and
 * cutoff.
 */
import {
  colourOf,
  finite,
  objectOf,
  ranged,
  rangedFields,
  refuse,
  type FogRange,
} from './fogChecks.ts'
import type { LinearRgb } from '../../contracts/material.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'

/** The volume of a height fog (`SceneHeightFog.volumetric`). */
export interface SceneVolumetricFog {
  /** How the light scatters, in [-0.9, 0.9] (held to ±0.99): 0 equally in every direction, nearer 1
   *  toward where the light goes, nearer −1 back toward its source. Beams seen from the side need
   *  a value near 0. 0.2 by default. */
  anisotropy?: number
  /** The share of the light each channel of a particle scatters, in [0, 1]: water is white, dust
   *  darker. White by default. */
  particleColor?: LinearRgb
  /** The light the fog emits, per unit of what it crosses, linear RGB: a density, so it adds the
   *  more the longer the ray crosses; black by default. Written in the numbers of the engines that
   *  fixed it, per centimetre divided by 10 000: a value of 1 is 1 / 100 per metre
   *  (`GLOW_PER_METRE`). */
  glow?: LinearRgb
  /** Scales the extinction the volume reads: above 1, particles absorb more; 1 by default. */
  densityScale?: number
  /** The distance the volume covers past `startAt`, metres, along the view; 60 by default.
   *  Longer reaches show the grid's coarseness. */
  reach?: number
  /** Where the volume starts, metres from the eye; 0 by default. */
  startAt?: number
  /** The distance over which the volume fades in from its start, metres; 0 by default, none. */
  fadeInLength?: number
  /** Whether the fog's own colours scatter the lights: its `color` for the sky light and its
   *  `directional.color` for the sun. It lets the volume match the fog in the distance, at the
   *  price of light that is not the surfaces'. False by default. */
  useFogColors?: boolean
  /** The share of the baked indirect light (the volumetric lightmap, `volumetricLightmap`) the
   *  volume scatters, 0 or more: the indirect light of the stationary lights and the direct and
   *  indirect light of the static ones, which no dynamic light gives it. 1 by default. */
  staticLightingScatteringIntensity?: number
}

/** A volume with every field set. */
export interface ResolvedVolumetricFog {
  anisotropy: number
  particleColor: LinearRgb
  glow: LinearRgb
  densityScale: number
  /** How far from the eye the volume reaches: its start and its distance, never below 0. */
  farEnd: number
  startAt: number
  /** The inverse of the fade-in distance; a hundred million where there is none. */
  fadeInRate: number
  useFogColors: boolean
  /** The share of the baked indirect light the volume scatters, never below 0. */
  staticLightingScatteringIntensity: number
}

/** The defaults of the volume, the converted ones of the engines that fixed them (6000
 *  centimetres are 60 metres). */
export const VOLUMETRIC_FOG_DEFAULTS = {
  anisotropy: 0.2,
  particleColor: [1, 1, 1],
  glow: [0, 0, 0],
  densityScale: 1,
  reach: 60,
  startAt: 0,
  fadeInLength: 0,
  useFogColors: false,
  staticLightingScatteringIntensity: 1,
} as const satisfies Required<SceneVolumetricFog>

/** What a glow number of the engines that fixed it gives per metre: they write it per
 *  centimetre, divided by 10 000, which is 1 / 100 per metre. */
export const GLOW_PER_METRE = 1 / 100

/** The nearest the scattering distribution comes to ±1, where the phase function is finite. */
const DISTRIBUTION_LIMIT = 0.99
/** The inverse fade-in of a volume that fades nothing: a hundred million per metre. */
const NO_FADE_IN = 1e8

/** The volume an option is, every field set, or nothing where the option is off: `true` the
 *  defaults, `false` or absent off, an object the defaults under its fields. The one reading of the
 *  option, whoever takes it. */
export function resolveVolumetricFog(
  option: boolean | SceneVolumetricFog | undefined,
): ResolvedVolumetricFog | undefined {
  if (!option) return undefined
  const d = VOLUMETRIC_FOG_DEFAULTS
  const v = option === true ? {} : option
  const start = v.startAt ?? d.startAt
  const fade = v.fadeInLength ?? d.fadeInLength
  const glow = v.glow ?? d.glow
  return {
    anisotropy: clamp(v.anisotropy ?? d.anisotropy, -DISTRIBUTION_LIMIT, DISTRIBUTION_LIMIT),
    particleColor: v.particleColor ?? d.particleColor,
    glow: [0, 1, 2].map((c) => Math.max(glow[c] * GLOW_PER_METRE, 0)) as unknown as LinearRgb,
    densityScale: Math.max(v.densityScale ?? d.densityScale, 0),
    farEnd: Math.max(start + (v.reach ?? d.reach), 0),
    startAt: start,
    fadeInRate: fade > 0 ? 1 / fade : NO_FADE_IN,
    useFogColors: v.useFogColors ?? d.useFogColors,
    staticLightingScatteringIntensity: Math.max(
      v.staticLightingScatteringIntensity ?? d.staticLightingScatteringIntensity,
      0,
    ),
  }
}

/** The range of each of the volume's distances, its extinction scale and its baked light's share. */
const VOLUMETRIC_RANGES = {
  densityScale: [0, Infinity],
  reach: [0, Infinity],
  startAt: [0, Infinity],
  fadeInLength: [0, Infinity],
  staticLightingScatteringIntensity: [0, Infinity],
} as const satisfies Record<string, FogRange>

/** A volume option checked: `true`, `false`, or an object whose numbers are finite, the distances
 *  ≥ 0, the particleColor's channels in [0, 1], and whose switch is a boolean; a copy. */
export function validateVolumetricFog(option: unknown, fog: unknown): boolean | SceneVolumetricFog {
  if (typeof option === 'boolean') return option
  const v = objectOf<SceneVolumetricFog>(option, 'volumetric', fog)
  const out: SceneVolumetricFog = {}
  if (v.anisotropy !== undefined) {
    if (!finite(v.anisotropy)) refuse('volumetric.anisotropy must be a finite number', fog)
    out.anisotropy = v.anisotropy
  }
  if (v.particleColor !== undefined) {
    const particleColor = colourOf(v.particleColor, 'volumetric.particleColor', fog)
    particleColor.forEach((c) => ranged(c, 'volumetric.particleColor', [0, 1], fog))
    out.particleColor = particleColor
  }
  if (v.glow !== undefined) out.glow = colourOf(v.glow, 'volumetric.glow', fog)
  rangedFields(v, out, VOLUMETRIC_RANGES, fog, 'volumetric.')
  if (v.useFogColors !== undefined) {
    if (typeof v.useFogColors !== 'boolean')
      refuse('volumetric.useFogColors must be a boolean', fog)
    out.useFogColors = v.useFogColors
  }
  return out
}
