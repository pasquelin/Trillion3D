import { TAU } from '../../../../math/src/constants.ts'

/** Millimetres in a centimetre: the profile's lengths are authored in cm and scattered in mm. */
export const CM_TO_MM = 10

/** A colour, linear, four channels: the red, green and blue and the one that rides along (the
 *  alpha of a texel of the profile table). */
export type Rgba = [number, number, number, number]

/** The normalised diffusion profile at `radiusMm` for one channel: the albedo `a`, the scaling
 *  factor `s` and the diffuse mean free path `l` (mm). Zero where `l` is not positive. */
export function diffusionProfile(radiusMm: number, a: number, s: number, l: number) {
  if (l <= 0) return 0
  const d = 1 / s,
    negRByD = -(radiusMm / l) / d
  return a * Math.max((Math.exp(negRByD) + Math.exp(negRByD / 3)) / (d * l) / (4 * TAU), 0)
}

/** The transmission profile at `radiusMm` for one channel: the diffusion integrated from the
 *  radius to infinity. Zero where `l` is not positive. */
export function transmissionProfile(radiusMm: number, a: number, s: number, l: number) {
  if (l <= 0) return 0
  return 0.25 * a * (Math.exp((-s * radiusMm) / l) + 3 * Math.exp((-s * radiusMm) / (3 * l)))
}

/** The scaling factor of the diffuse mean free path on the surface (the search light method), for
 *  one channel of the surface albedo. */
export const searchLightScale = (albedo: number) => 3.5 + 100 * (albedo - 0.33) ** 4

/** The scaling factor of light entering the volume perpendicular to the surface, for one channel. */
const perpendicularScale = (albedo: number) => 1.85 - albedo + 7 * Math.abs(albedo - 0.8) ** 3

/** The factor from the diffuse mean free path to the mean free path (and back). */
const DMFP_TO_MFP = 0.6

/** The mean free path of a channel from its diffuse mean free path. */
export const meanFreePathOf = (albedo: number, dmfp: number) =>
  ((dmfp * perpendicularScale(albedo)) / searchLightScale(albedo)) * DMFP_TO_MFP

/** The diffuse mean free path of a channel from its mean free path. */
export const diffuseMeanFreePathOf = (albedo: number, mfp: number) =>
  (mfp * searchLightScale(albedo)) / (perpendicularScale(albedo) * DMFP_TO_MFP)

/** The surface albedo and the diffuse mean free path a falloff colour channel of the separable
 *  profile maps to (the polynomial fit of the separable profile's falloff). */
export function albedoAndDmfpOfFalloff(falloff: number): [number, number] {
  const x = falloff,
    x2 = x * x,
    x4 = x2 * x2
  return [
    0.906 * x + 0.00004,
    10.39 * x4 * x - 15.18 * x4 + 8.332 * x2 * x - 2.039 * x2 + 0.7279 * x - 0.0014,
  ]
}
