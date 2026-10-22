/**
 * THE ATMOSPHERE IN A GPU BLOCK: what every program that reads the air — the lookup tables'
 * builders, the sky, the haze a surface is seen through — finds in the light buffer, behind the
 * fog.
 *
 * Thirteen `vec4`, written by the CPU when the atmosphere or the sun changes (`packAtmosphere`),
 * the slots below by number. The sun is the directional light that lights the air: its direction
 * toward it, its illuminance outside the air, the luminance of its disk, and the transmittance of
 * the air toward it at the ground (what tints the light surfaces receive, `SunLight`).
 */
import type { ResolvedAtmosphere } from './atmosphere.ts'
import { coefficientsOf, diskSolidAngle, type Rgb } from './atmosphereOptics.ts'

/** The `vec4` slots of the block: the shaders read them by these numbers. */
export const ATMOSPHERE_SLOT = {
  /** Whether the atmosphere is on, the planet's bottom and top radius in kilometres, the ground's height in metres. */
  planet: 0,
  /** Rayleigh scattering per kilometre, then the exponent of its density. */
  rayleigh: 1,
  /** Mie scattering per kilometre, then the exponent of its density. */
  mieScattering: 2,
  /** Mie extinction per kilometre, then its anisotropy. */
  mieExtinction: 3,
  /** Ozone absorption per kilometre, then the altitude of its peak. */
  ozone: 4,
  /** The ozone density as two lines, `slope, constant` below the peak then above it. */
  ozoneLines: 5,
  /** The ground's albedo, then the multi-scattering factor. */
  ground: 6,
  /** The factor of the sky's radiance, then the haze's distance scale. */
  skyFactor: 7,
  /** The factor of the scattered radiance, then the distance before the haze starts, kilometres. */
  scatteredFactor: 8,
  /** The unit direction toward the sun, then the cosine of its disk's angular radius. */
  sunDirection: 9,
  /** The sun's illuminance outside the air, then the scale of the march's samples. */
  sunIlluminance: 10,
  /** The luminance of the sun's disk, then 1 when there is a sun. */
  sunDisk: 11,
  /** The transmittance of the air toward the sun at the ground, then the fog's contribution. */
  sunTransmittance: 12,
} as const

/** `vec4` slots of the block. */
export const ATMOSPHERE_SLOTS = 13
/** Floats of the block: four to a slot. Written as a literal, so a bundle that reads none keeps
 *  none. */
export const ATMOSPHERE_FLOATS = 52

/** The sun of the atmosphere: the directional light that lights the air. */
export interface AtmosphereSun {
  /** Where its light goes, a unit vector. */
  direction: readonly number[]
  /** Its illuminance outside the air, per channel: colour times intensity. */
  illuminance: Rgb
  /** The angular radius of its disk, radians, above 0. */
  angularRadius: number
}

/** The largest disk luminance written: what a half float holds with room for bloom and the
 *  temporal resolve (`65504 / 2`). */
const MAX_DISK_LUMINANCE = 32256

/**
 * Writes the block: all zero, the atmosphere off, without one. `transmittance` is the air's
 * toward the sun (`sunTransmittance`); without a sun the block holds the air alone and the sky
 * is dark.
 */
export function packAtmosphere(
  atmosphere: ResolvedAtmosphere | undefined,
  sun: AtmosphereSun | undefined,
  transmittance: Rgb,
  out: Float32Array,
) {
  out.fill(0, 0, ATMOSPHERE_FLOATS)
  if (!atmosphere) return out
  const k = coefficientsOf(atmosphere)
  const put = (slot: number, ...values: number[]) => out.set(values, slot * 4)
  put(ATMOSPHERE_SLOT.planet, 1, k.bottomRadius, k.topRadius, atmosphere.groundHeight)
  put(ATMOSPHERE_SLOT.rayleigh, ...k.rayleigh, k.rayleighExp)
  put(ATMOSPHERE_SLOT.mieScattering, ...k.mieScattering, k.mieExp)
  put(ATMOSPHERE_SLOT.mieExtinction, ...k.mieExtinction, k.mieAnisotropy)
  put(ATMOSPHERE_SLOT.ozone, ...k.ozone, k.ozoneAltitude)
  put(ATMOSPHERE_SLOT.ozoneLines, ...k.ozoneBelow, ...k.ozoneAbove)
  put(ATMOSPHERE_SLOT.ground, ...atmosphere.groundAlbedo, atmosphere.multiScatteringFactor)
  put(
    ATMOSPHERE_SLOT.skyFactor,
    ...atmosphere.skyLuminanceFactor,
    atmosphere.aerialPerspectiveDistanceScale,
  )
  put(
    ATMOSPHERE_SLOT.scatteredFactor,
    ...atmosphere.skyAndAerialPerspectiveLuminanceFactor,
    atmosphere.aerialPerspectiveStartDepth,
  )
  put(ATMOSPHERE_SLOT.sunTransmittance, ...transmittance, atmosphere.heightFogContribution)
  put(ATMOSPHERE_SLOT.sunIlluminance, 0, 0, 0, atmosphere.sampleCountScale)
  if (!sun) return out
  const toward = sun.direction.map((c) => -c)
  const solidAngle = diskSolidAngle(sun.angularRadius)
  const disk = sun.illuminance.map((c) => Math.min(c / solidAngle, MAX_DISK_LUMINANCE))
  put(ATMOSPHERE_SLOT.sunDirection, ...toward, Math.cos(sun.angularRadius))
  put(ATMOSPHERE_SLOT.sunIlluminance, ...sun.illuminance, atmosphere.sampleCountScale)
  put(ATMOSPHERE_SLOT.sunDisk, ...disk, 1)
  return out
}
