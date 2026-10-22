/**
 * THE ATMOSPHERE IN A GPU BLOCK: what every program that reads the air — the lookup tables'
 * builders, the sky, the haze a surface is seen through — finds in the light buffer, behind the
 * fog.
 *
 * Nineteen `vec4`, written by the CPU when the atmosphere or the suns change (`packAtmosphere`),
 * the slots below by number. The sun is the directional light that lights the air: its direction
 * toward it, its illuminance outside the air, the luminance of its disk, and the transmittance of
 * the air toward it at the ground (what tints the light surfaces receive, `SunLight`). The air
 * holds a second light in the same four, a moon or a second sun: its disk slot says, by its last
 * lane, whether there is one; where there is none, the programs read nothing of it.
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
  /** The unit direction toward the second light, then the cosine of its disk's angular radius. */
  secondDirection: 13,
  /** The second light's illuminance outside the air. */
  secondIlluminance: 14,
  /** The luminance of the second light's disk, then 1 when there is a second light. */
  secondDisk: 15,
  /** The transmittance of the air toward the second light at the ground. */
  secondTransmittance: 16,
  /** For the sun then the second light: whether its shadow shades the air, then whether the
   *  transmittance toward it is read for each surface point (the sun's two, the second light's two). */
  lightFlags: 17,
  /** For the sun then the second light: its slot in the light buffer, −1 where it has none. */
  lightSlots: 18,
} as const

/** `vec4` slots of the block. */
export const ATMOSPHERE_SLOTS = 19
/** Floats of the block: four to a slot. Written as a literal, so a bundle that reads none keeps
 *  none. */
export const ATMOSPHERE_FLOATS = 76

/** A light of the atmosphere: a directional light that lights the air. */
export interface AtmosphereSun {
  /** Where its light goes, a unit vector. */
  direction: readonly number[]
  /** Its illuminance outside the air, per channel: colour (with its temperature) times intensity. */
  illuminance: Rgb
  /** The angular radius of its disk, radians, above 0. */
  angularRadius: number
  /** The transmittance of the air toward it at the ground, per channel. */
  transmittance: Rgb
  /** The colour its disk is multiplied by; white when absent. */
  diskTint?: Rgb
  /** Whether its shadow shades the air; off when absent. */
  shadowsAir?: boolean
  /** Whether the transmittance toward it is read per surface point; off when absent. */
  perPixel?: boolean
  /** Its slot in the light buffer; none when absent. */
  lightSlot?: number
}

/** The colour of a disk that is not tinted. */
const NO_TINT: Rgb = [1, 1, 1]

/** The slots a light's numbers go to: its direction toward it, its illuminance, its disk, the
 *  transmittance of the air toward it. */
interface SunSlots {
  direction: number
  illuminance: number
  disk: number
  transmittance: number
}

/** The slots of each light of the air, by index: the sun's, then the second light's. */
const SUN_SLOTS: readonly SunSlots[] = [
  {
    direction: ATMOSPHERE_SLOT.sunDirection,
    illuminance: ATMOSPHERE_SLOT.sunIlluminance,
    disk: ATMOSPHERE_SLOT.sunDisk,
    transmittance: ATMOSPHERE_SLOT.sunTransmittance,
  },
  {
    direction: ATMOSPHERE_SLOT.secondDirection,
    illuminance: ATMOSPHERE_SLOT.secondIlluminance,
    disk: ATMOSPHERE_SLOT.secondDisk,
    transmittance: ATMOSPHERE_SLOT.secondTransmittance,
  },
]

/** Writes `values` from the start of `slot`: the lanes after them keep what they hold. */
const putSlot = (out: Float32Array, slot: number, ...values: number[]) => out.set(values, slot * 4)

/** Writes a light into its slots: the direction toward it and its disk's cosine, its illuminance,
 *  the luminance of its disk and a one (there is a light), the air's transmittance toward it. */
function putSun(out: Float32Array, at: SunSlots, sun: AtmosphereSun) {
  const solidAngle = diskSolidAngle(sun.angularRadius)
  const tint = sun.diskTint ?? NO_TINT
  const disk = sun.illuminance.map((c, i) => (c * tint[i]) / solidAngle)
  putSlot(out, at.direction, ...sun.direction.map((c) => -c), Math.cos(sun.angularRadius))
  putSlot(out, at.illuminance, ...sun.illuminance)
  putSlot(out, at.disk, ...disk, 1)
  putSlot(out, at.transmittance, ...sun.transmittance)
}

/**
 * Writes the block: all zero, the atmosphere off, without one. `suns` holds the lights of the air
 * by index, none where there is none: a light writes its slots (`SUN_SLOTS`), and the programs
 * read nothing of a light whose disk slot says there is none. Without a light the block holds the
 * air alone and the sky is dark; the transmittance toward the sun is one.
 */
export function packAtmosphere(
  atmosphere: ResolvedAtmosphere | undefined,
  suns: readonly (AtmosphereSun | undefined)[],
  out: Float32Array,
) {
  out.fill(0, 0, ATMOSPHERE_FLOATS)
  if (!atmosphere) return out
  const k = coefficientsOf(atmosphere)
  const put = (slot: number, ...values: number[]) => putSlot(out, slot, ...values)
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
  put(ATMOSPHERE_SLOT.sunTransmittance, 1, 1, 1, atmosphere.heightFogContribution)
  put(ATMOSPHERE_SLOT.sunIlluminance, 0, 0, 0, atmosphere.sampleCountScale)
  const flags = [0, 0, 0, 0],
    slots = [-1, -1, 0, 0]
  suns.forEach((sun, index) => {
    if (!sun) return
    putSun(out, SUN_SLOTS[index], sun)
    flags[index] = sun.shadowsAir ? 1 : 0
    flags[2 + index] = sun.perPixel ? 1 : 0
    slots[index] = sun.lightSlot ?? -1
  })
  put(ATMOSPHERE_SLOT.lightFlags, ...flags)
  put(ATMOSPHERE_SLOT.lightSlots, ...slots)
  return out
}
