import { clamp } from '../../../../math/src/scalar/reals.ts'
import { SUBSURFACE_KERNEL_SIZE } from '../../contracts/subsurfaceScatteringOptions.ts'
import { CM_TO_MM, albedoAndDmfpOfFalloff, meanFreePathOf } from './burleyMath.ts'

/** How the profile is scattered: adaptive filtered importance sampling (the accurate one) or the
 *  two separable passes (the fast one, for a large covering such as ice or snow). */
export type SubsurfaceImplementation = 'importanceSampling' | 'separable'

/**
 * A subsurface profile: what the scattering of one material needs. The colours are linear RGB.
 * A profile written in the older separable terms (`burley: false`: `scatterRadius`,
 * `subsurfaceColor`, `falloffColor`) is converted to the normalised terms when the table is built,
 * as is one written with a diffuse mean free path (`meanFreePath: false`).
 */
export interface SubsurfaceProfile {
  /** The base colour of the material the profile belongs to, as near as possible. */
  surfaceAlbedo: [number, number, number]
  /** How far the light goes in each channel, scaled by `meanFreePathDistance`. */
  meanFreePathColor: [number, number, number]
  /** The mean free path, in cm. */
  meanFreePathDistance: number
  /** The scale of the world unit (cm). */
  worldUnitScale: number
  /** True: the normalised terms above are the profile. False: the separable terms below. */
  burley: boolean
  /** True: the mean free path terms; false: they hold a diffuse mean free path. */
  meanFreePath: boolean
  /** How much of the diffuse light gets into the material, per channel: the mix between the
   *  original image and the scattered one. */
  tint: [number, number, number]
  /** Separable terms (used while `burley` is false): the radius in cm, the strength, the falloff. */
  scatterRadius: number
  subsurfaceColor: [number, number, number]
  falloffColor: [number, number, number]
  boundaryColorBleed: [number, number, number]
  implementation: SubsurfaceImplementation
  /** 1 is the physical extinction. */
  extinctionScale: number
  normalScale: number
  /** 1 is the physical scale of the transmission. */
  distanceScale: number
  scatteringDistribution: number
  ior: number
  /** The two lobes of the dual specular and their mix. */
  roughness0: number
  roughness1: number
  lobeMix: number
  transmissionTintColor: [number, number, number]
}

/** The opacity above which a surface of the subsurface-profile model scatters: at or below it, the pixel is lit as the plain model. */
export const SUBSURFACE_OPACITY_THRESHOLD = 0.1

/** The default profile (human skin). */
const DEFAULT_SUBSURFACE_PROFILE: Readonly<SubsurfaceProfile> = {
  scatterRadius: 1.2,
  subsurfaceColor: [0.48, 0.41, 0.28],
  falloffColor: [1, 0.37, 0.3],
  boundaryColorBleed: [1, 1, 1],
  extinctionScale: 1,
  scatteringDistribution: 0.93,
  normalScale: 0.08,
  ior: 1.55,
  roughness0: 0.75,
  roughness1: 1.3,
  lobeMix: 0.85,
  burley: false,
  surfaceAlbedo: [0.91058, 0.338275, 0.2718],
  meanFreePathColor: [1, 0.1983 / 2.229, 0.1607 / 2.229],
  meanFreePathDistance: 1.2 * 2.229,
  worldUnitScale: 0.1,
  transmissionTintColor: [1, 1, 1],
  tint: [1, 1, 1],
  implementation: 'importanceSampling',
  meanFreePath: false,
  distanceScale: 1,
}

/** What a page may pass for a profile: any of its fields, the others the default skin's. */
export type SubsurfaceProfileInput = Partial<SubsurfaceProfile>

const isChannels = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every((c) => Number.isFinite(c))

/** `input` as a whole profile: each field it gives of the right kind, the default skin's for the others and for a field of
 *  another kind (a number for a number, three numbers for a colour, a switch for a switch, a name for the implementation). */
export function resolveSubsurfaceProfile(input: SubsurfaceProfileInput): SubsurfaceProfile {
  const out: Record<string, unknown> = {}
  for (const [key, fallback] of Object.entries(DEFAULT_SUBSURFACE_PROFILE)) {
    const value = (input as Record<string, unknown>)[key]
    const fits = Array.isArray(fallback)
      ? isChannels(value)
      : typeof fallback === 'number'
        ? Number.isFinite(value)
        : typeof fallback === 'boolean'
          ? typeof value === 'boolean'
          : value === 'importanceSampling' || value === 'separable'
    out[key] = fits ? (Array.isArray(value) ? [...value] : value) : structuredClone(fallback)
  }
  return out as unknown as SubsurfaceProfile
}

/** `profile` in the normalised, mean free path terms (a copy; one already in them is unchanged). */
export function upgradedProfile(profile: SubsurfaceProfile): SubsurfaceProfile {
  const out: SubsurfaceProfile = structuredClone(profile)
  if (!out.burley) {
    const albedo: number[] = [],
      mfp: number[] = []
    for (const falloff of out.falloffColor) {
      const [a, d] = albedoAndDmfpOfFalloff(falloff)
      albedo.push(a)
      mfp.push(d)
    }
    out.surfaceAlbedo = albedo as SubsurfaceProfile['surfaceAlbedo']
    out.meanFreePathColor = mfp as SubsurfaceProfile['meanFreePathColor']
    const max = Math.max(...mfp)
    if (max > 1) {
      out.meanFreePathColor = mfp.map((v) => v / max) as SubsurfaceProfile['meanFreePathColor']
      out.meanFreePathDistance = clamp(out.scatterRadius * max, 0.1, 50)
    }
    out.meanFreePathDistance /= 2.229 * 2.229
    out.tint = [...out.subsurfaceColor]
    out.burley = true
  }
  if (!out.meanFreePath) {
    const old = out.meanFreePathColor.map((v) => v * out.meanFreePathDistance),
      mfp = old.map((v, c) => meanFreePathOf(out.surfaceAlbedo[c]!, v)),
      max = Math.max(...mfp)
    out.meanFreePathDistance = max
    out.meanFreePathColor = mfp.map((v) => v / max) as SubsurfaceProfile['meanFreePathColor']
    if (max < 0.1) {
      out.meanFreePathColor = out.meanFreePathColor.map(
        (v) => v * (max / 0.1),
      ) as SubsurfaceProfile['meanFreePathColor']
      out.meanFreePathDistance = 0.1
    }
    out.meanFreePath = true
    out.worldUnitScale /= SUBSURFACE_KERNEL_SIZE / CM_TO_MM
  }
  return out
}

/** The profile of table row 0, the one a surface without a profile takes: the default skin,
 *  upgraded, its transmission scaled as the older profiles were. */
export function defaultSkinProfile(): SubsurfaceProfile {
  const skin = upgradedProfile(DEFAULT_SUBSURFACE_PROFILE)
  skin.extinctionScale *= 3.1
  skin.distanceScale *= 10
  skin.transmissionTintColor = skin.transmissionTintColor.map(
    (v, c) => v * skin.surfaceAlbedo[c]!,
  ) as SubsurfaceProfile['transmissionTintColor']
  return skin
}
