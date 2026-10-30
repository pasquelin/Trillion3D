/**
 * HEIGHT FOG: A MEDIUM THAT THINS OUT WITH HEIGHT, ITS LAW, ITS UNITS AND ITS DEFAULTS.
 *
 * The fog most scenes declare: air that is dense near a base height and halves its density every
 * `1 / falloff` metres up, lit from the sky and the sun. Its numbers are those of the engines
 * that fixed them, in scene metres; the conversion from their centimetre numbers is exact and
 * stated once, here:
 * - density per metre = their density ÷ 10 (they divide by 1000 per centimetre; ×100 centimetres
 *   to the metre): their 0.02 is `baseDensity` 0.002;
 * - falloff per metre = their falloff ÷ 10: their 0.2 is `falloff` 0.02, a halving every 50 m;
 * - every distance in metres = their centimetres ÷ 100: their 10 000 is a `startDistance` of 100;
 * - colours and the sun's illuminance are in the same units as a surface's radiance.
 *
 * The law. The density at the height `y` is `baseDensity · 2^(−falloff · (y − baseHeight))`. A ray
 * of length `d` rising by `dy` from an eye at the height `yEye` gathers
 * `X = baseDensity · 2^(−falloff · (yEye − baseHeight)) · d · (1 − 2^(−F)) / F`, `F = falloff · dy`
 * (`ln 2` where `F` is nil), and the light that crosses is `T = 2^(−X)`, never below
 * `1 − maxOpacity`. That is `ln 2` times the line integral of the density, as the exponent of 2:
 * a uniform medium of `baseDensity` thus extinguishes at `(ln 2)² · baseDensity` per metre. What
 * the fog scatters toward the eye is `color · (1 − T)`, the sky's mean radiance times
 * `skyContribution` and the atmosphere's `heightFogContribution` added to `color` where an
 * atmosphere is on, plus the sun's lobe: `(directional.color · sunLuminance + heightFogContribution
 * · the sun's illuminance on the ground) · max(0, ray · sun)^exponent / 4π`, through the density
 * met past `directional.startDistance`.
 *
 * Five more things, each off by default (a fog that names none of them is the fog above): a second
 * layer (`fogSecond.ts`) whose integral adds to the first's; an end distance past which, on the
 * horizontal, the ray stops integrating; a cubemap (`fogCubemap.ts`) the colour is read from by
 * direction; a volume (`fogVolumetric.ts`) that scatters the lights in beams; a screen-space
 * scattering (`fogScreenSpace.ts`) that blurs the fog and the image behind it.
 *
 * Where it is drawn. Three switches, each on by default, say in which views the fog shows:
 * `inMainView`, the views the page draws (the camera's and the extra views of the page);
 * `inSkyCapture`, the distant fog laid over the sky of the sky light's real-time capture;
 * `inReflectionCaptures`, the scene the sky light captures from its own place (`capturedScene`).
 * The sky light's capture can also light the fog (`skyLightScattering`, strength 0 by default):
 * the fog's in-scattering colour is then the filtered cube read along the ray, at the mip of the
 * `roughness`, times the light's colour, mixed in by the `strength`, and the sun's lobe fades by it;
 * while the strength is above 0 the fog's own cubemap is not read.
 *
 * The extinction form of the exponential law of `fog.ts` is a spelling of this law, which
 * `heightFogOf` maps exactly to the numbers the GPU reads.
 */
import type { LinearRgb } from '../../contracts/material.ts'
import type { SceneExponentialFog } from './fog.ts'
import { resolveFogCubemap, type ResolvedFogCubemap, type SceneFogCubemap } from './fogCubemap.ts'
import {
  resolveSecondLayer,
  SECOND_FOG_DEFAULTS,
  type ResolvedSecondLayer,
  type SceneSecondLayer,
} from './fogSecond.ts'
import {
  resolveFogScreenSpaceScattering,
  type ResolvedFogScreenSpaceScattering,
  type SceneFogScreenSpaceScattering,
} from './fogScreenSpace.ts'
import {
  resolveVolumetricFog,
  type ResolvedVolumetricFog,
  type SceneVolumetricFog,
} from './fogVolumetric.ts'

/** The sun's lobe in the fog: scattered toward the sun beyond `startDistance`, sharper the
 *  higher the `exponent`. */
export interface SceneFogDirectional {
  /** The lobe's sharpness, above 0: the light scattered is `max(0, ray · sun)^exponent`; 4 by
   *  default. */
  exponent?: number
  /** The distance along the ray, metres, before the sun's light is scattered; 100 by default. */
  startDistance?: number
  /** The luminance scattered toward the sun, linear RGB, times the sun's own luminance; black by
   *  default: only the atmosphere's sun light is then scattered. */
  color?: LinearRgb
}

/** Height fog by its law (`fogHeight.ts`): density and falloff per metre, base 2.
 *  Every field has its default, `{}` is the default fog. */
export interface SceneHeightFog {
  /** The light the fog scatters by itself, linear RGB; black by default — an atmosphere then
   *  gives it its colour. */
  color?: LinearRgb
  /** The density at `baseHeight`, per metre, ≥ 0; 0.002 by default. */
  baseDensity?: number
  /** How fast the density falls off with height, per metre, ≥ 0: it halves every `1 / falloff`
   *  metres; 0.02 by default; 0 keeps it uniform. */
  falloff?: number
  /** The height the density is `baseDensity` at, metres; 0 by default. */
  baseHeight?: number
  /** The most of a surface's light the fog may hide, in [0, 1]; 1 by default. */
  maxOpacity?: number
  /** The distance from the eye, metres, where the fog starts; 0 by default. */
  startDistance?: number
  /** The distance from the eye, metres, past which there is no fog at all; 0, the default, none. */
  cutoffDistance?: number
  /** The sun's lobe. */
  directional?: SceneFogDirectional
  /** The factor of the atmosphere's sky radiance the fog takes on, per channel, ≥ 0; white by
   *  default. */
  skyContribution?: LinearRgb
  /** A second layer of fog, added to the first (`SceneSecondLayer`); none by default. */
  secondLayer?: SceneSecondLayer
  /** The distance from the eye, metres on the horizontal, where the ray stops integrating the fog's
   *  light and transmittance; 0, the default, none. */
  horizontalLimit?: number
  /** A cubemap the fog's colour is read from by direction (`SceneFogCubemap`); none by default. With
   *  one, the fog's `color` and the sun's lobe are not read: the cubemap, tinted, gives the colour. */
  cubemap?: SceneFogCubemap
  /** The volume that scatters the lights in beams (`SceneVolumetricFog`): `true` for its defaults;
   *  off by default. */
  volumetric?: boolean | SceneVolumetricFog
  /** The fog blurred in the plane of the screen to stand for its multiple scattering
   *  (`SceneFogScreenSpaceScattering`): `true` for its defaults; off by default. */
  screenSpaceScattering?: boolean | SceneFogScreenSpaceScattering
  /** Whether the views the page draws show the fog; true by default. */
  inMainView?: boolean
  /** Whether the distant fog is laid over the sky of the sky light's real-time capture, and so
   *  lights the scene through it; true by default. */
  inSkyCapture?: boolean
  /** Whether the scene the sky light captures from its own place (the source `capturedScene`)
   *  shows the fog; true by default. */
  inReflectionCaptures?: boolean
  /** Whether the fog holds its light out: it draws black and punches a hole in the image's alpha by
   *  its coverage instead of lighting the image. It takes effect with the alpha holdout
   *  (`primitiveAlphaHoldout`, `propagateAlpha`, `../../contracts/filmOptions.ts`); false by default. */
  holdout?: boolean
  /** The sky light's capture as a light of the fog (`SceneSkyLightScattering`); none by default. */
  skyLightScattering?: SceneSkyLightScattering
}

/** The sky light's capture lighting the fog (`SceneHeightFog.skyLightScattering`). It applies where
 *  the run's `fogReadsSkyLight` is on, the sky lighting is on in the view and the sky light has a
 *  cube. */
export interface SceneSkyLightScattering {
  /** How far the fog's in-scattering colour is the sky light's rather than its own: the two are
   *  mixed by this share, and the sun's lobe fades by it; from 0 (none, the default), 1 the sky
   *  light's alone. */
  strength?: number
  /** The roughness the cube is read at, in [0, 1] (0.15 by default): the blur of the read, which
   *  stands for the dispersion a phase function gives. */
  roughness?: number
}

/** A height fog with every field set: what the GPU block is made of. */
export interface ResolvedHeightFog {
  color: LinearRgb
  baseDensity: number
  falloff: number
  baseHeight: number
  maxOpacity: number
  startDistance: number
  cutoffDistance: number
  directional: Required<SceneFogDirectional>
  skyContribution: LinearRgb
  second: ResolvedSecondLayer
  horizontalLimit: number
  /** Absent where the fog has none. */
  cubemap?: ResolvedFogCubemap
  /** Absent where the volume is off. */
  volumetric?: ResolvedVolumetricFog
  /** Absent where the screen-space scattering is off. */
  screenSpaceScattering?: ResolvedFogScreenSpaceScattering
  inMainView: boolean
  inSkyCapture: boolean
  inReflectionCaptures: boolean
  holdout: boolean
  skyLightScattering: Required<SceneSkyLightScattering>
}

/** The defaults of a height fog, the converted ones of the engines that fixed them: those of the fog
 *  component, whose density 0.02 and falloff 0.2 are `baseDensity` 0.002 and `falloff` 0.02 here, at
 *  the origin. The fog of the sky module's level is another object, placed lower and denser
 *  (`modules/sky/descriptor.ts`); this one is the default of every fog a scene declares itself. */
export const HEIGHT_FOG_DEFAULTS: ResolvedHeightFog = {
  color: [0, 0, 0],
  baseDensity: 0.002,
  falloff: 0.02,
  baseHeight: 0,
  maxOpacity: 1,
  startDistance: 0,
  cutoffDistance: 0,
  directional: { exponent: 4, startDistance: 100, color: [0, 0, 0] },
  skyContribution: [1, 1, 1],
  second: SECOND_FOG_DEFAULTS,
  horizontalLimit: 0,
  inMainView: true,
  inSkyCapture: true,
  inReflectionCaptures: true,
  holdout: false,
  skyLightScattering: { strength: 0, roughness: 0.15 },
}

/** The extinction a density of 1 gives a uniform medium: `(ln 2)²` per metre, written as the
 *  literal of `Math.LN2 * Math.LN2`, so a bundle that reads none keeps none. */
const EXTINCTION_PER_DENSITY = 0.4804530139182014

/** Whether a fog is the extinction form: a medium of `density` per metre, divided by e (not 2)
 *  every `1 / heightFalloff` metres up. */
export const isExtinctionFog = (fog: object): fog is SceneExponentialFog =>
  'density' in fog || 'heightFalloff' in fog

/** The directional lobe a declaration is, over the defaults. */
function directionalOf(
  directional: SceneHeightFog['directional'],
): ResolvedHeightFog['directional'] {
  const d = HEIGHT_FOG_DEFAULTS.directional
  return {
    exponent: directional?.exponent ?? d.exponent,
    startDistance: directional?.startDistance ?? d.startDistance,
    color: directional?.color ?? d.color,
  }
}

/** The sky light scattering a declaration is, over the defaults. */
function skyLightScatteringOf(
  scattering: SceneHeightFog['skyLightScattering'],
): ResolvedHeightFog['skyLightScattering'] {
  const d = HEIGHT_FOG_DEFAULTS.skyLightScattering
  return {
    strength: scattering?.strength ?? d.strength,
    roughness: scattering?.roughness ?? d.roughness,
  }
}

/** The height fog a declaration is, every field set: a height fog over its defaults, or an
 *  extinction-form fog mapped exactly — its extinction `s` is `baseDensity · (ln 2)²`, its natural
 *  falloff `k` is `falloff · ln 2` — with the defaults for the rest. */
export function heightFogOf(fog: SceneExponentialFog | SceneHeightFog): ResolvedHeightFog {
  const d = HEIGHT_FOG_DEFAULTS
  if (isExtinctionFog(fog))
    return {
      ...d,
      color: fog.color,
      baseDensity: fog.density / EXTINCTION_PER_DENSITY,
      falloff: (fog.heightFalloff ?? 0) / Math.LN2,
      baseHeight: fog.baseHeight ?? d.baseHeight,
    }
  return {
    color: fog.color ?? d.color,
    baseDensity: fog.baseDensity ?? d.baseDensity,
    falloff: fog.falloff ?? d.falloff,
    baseHeight: fog.baseHeight ?? d.baseHeight,
    maxOpacity: fog.maxOpacity ?? d.maxOpacity,
    startDistance: fog.startDistance ?? d.startDistance,
    cutoffDistance: fog.cutoffDistance ?? d.cutoffDistance,
    directional: directionalOf(fog.directional),
    skyContribution: fog.skyContribution ?? d.skyContribution,
    second: resolveSecondLayer(fog.secondLayer),
    horizontalLimit: fog.horizontalLimit ?? d.horizontalLimit,
    cubemap: fog.cubemap && resolveFogCubemap(fog.cubemap),
    volumetric: resolveVolumetricFog(fog.volumetric),
    screenSpaceScattering: resolveFogScreenSpaceScattering(fog.screenSpaceScattering),
    inMainView: fog.inMainView ?? d.inMainView,
    inSkyCapture: fog.inSkyCapture ?? d.inSkyCapture,
    inReflectionCaptures: fog.inReflectionCaptures ?? d.inReflectionCaptures,
    holdout: fog.holdout ?? d.holdout,
    skyLightScattering: skyLightScatteringOf(fog.skyLightScattering),
  }
}
