/**
 * THE ATMOSPHERE'S OPTICS ON THE CPU: the coefficients the air is marched with, and the light of
 * the sun through it.
 *
 * Three constituents scatter or absorb (`SceneAtmosphere`); at a height `h` above the ground their
 * densities are `exp(−h / H)` for the Rayleigh air and the Mie haze, and a tent for the ozone.
 * The extinction along a ray is the sum of their coefficients times their densities; the
 * transmittance is `exp(−∫ extinction dt)`. The GPU marches this for the sky and the haze
 * (`lighting/atmosphere/`); the sun's light reaching the ground needs one ray only, so it is
 * integrated here, once, when the atmosphere or the sun moves: a surface is lit by the sun's
 * illuminance times that transmittance (`SunLight`), and the sky by the same sun outside the air.
 */
import type { ResolvedAtmosphere } from './atmosphere.ts'
import { DEG2RAD, TAU } from '../../../../math/src/constants.ts'
import { clamp, clampLowWins } from '../../../../math/src/scalar/reals.ts'
import { dotVector3, length2 } from '../../../../math/src/vector/vector.ts'

/** Three channels, red, green, blue. */
export type Rgb = readonly [number, number, number]

/** An atmosphere as the marching reads it: radii in kilometres, coefficients per kilometre. */
export interface AtmosphereCoefficients {
  bottomRadius: number
  topRadius: number
  /** Rayleigh scattering at the ground; its density falls as `exp(rayleighExp · h)`. */
  rayleigh: Rgb
  rayleighExp: number
  /** Mie scattering and extinction (scattering plus absorption); density `exp(mieExp · h)`. */
  mieScattering: Rgb
  mieExtinction: Rgb
  mieExp: number
  mieAnisotropy: number
  /** Ozone absorption at a density of 1, and its density as two lines, below and above the
   *  layer's peak altitude: `density = saturate(linear · h + constant)`. */
  ozone: Rgb
  ozoneAltitude: number
  ozoneBelow: readonly [number, number]
  ozoneAbove: readonly [number, number]
}

/** Never thinner than this, kilometres: a planet's air of no height has nothing to march. */
const MIN_HEIGHT = 0.1

/** The radius of the top of `a`'s air, kilometres: the planet's plus its height, never thinner than
 *  `MIN_HEIGHT`. */
const topRadiusOf = (a: ResolvedAtmosphere) => a.planetRadius + Math.max(MIN_HEIGHT, a.height)

const sum = (a: Rgb, b: Rgb): Rgb => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

/** The ozone tent as two lines meeting at its peak (none when it has no width or no height). */
function ozoneLines({ altitude, width, peak }: ResolvedAtmosphere['ozoneLayer']) {
  if (!(width > 0 && peak > 0)) return { below: [0, 0] as const, above: [0, 0] as const }
  const slope = peak / width
  return {
    below: [slope, peak - altitude * slope] as const,
    above: [-slope, peak + altitude * slope] as const,
  }
}

/** The coefficients of `a`, derived once when the atmosphere changes. */
export function coefficientsOf(a: ResolvedAtmosphere): AtmosphereCoefficients {
  const lines = ozoneLines(a.ozoneLayer)
  return {
    bottomRadius: a.planetRadius,
    topRadius: topRadiusOf(a),
    rayleigh: a.rayleighScattering,
    rayleighExp: -1 / a.rayleighScaleHeight,
    mieScattering: a.mieScattering,
    mieExtinction: sum(a.mieScattering, a.mieAbsorption),
    mieExp: -1 / a.mieScaleHeight,
    mieAnisotropy: a.mieAnisotropy,
    ozone: a.ozoneAbsorption,
    ozoneAltitude: a.ozoneLayer.altitude,
    ozoneBelow: lines.below,
    ozoneAbove: lines.above,
  }
}

/** Distance along a ray to the first point of a sphere at the origin, `radius` large, the ray
 *  starting at `origin` inside or outside it: `-1` when it never meets it. */
function nearestHit(origin: Rgb, direction: Rgb, radius: number) {
  const b = 2 * dotVector3(origin, direction)
  const c = origin[0] ** 2 + origin[1] ** 2 + origin[2] ** 2 - radius * radius
  const discriminant = b * b - 4 * c
  if (discriminant < 0) return -1
  const root = Math.sqrt(discriminant)
  const near = (-b - root) / 2,
    far = (-b + root) / 2
  if (near < 0 && far < 0) return -1
  if (near < 0) return Math.max(0, far)
  if (far < 0) return Math.max(0, near)
  return clampLowWins(far, 0, near)
}

/** Altitude above the sun's reference point, kilometres: the transmittance is read from there
 *  (500 m over the ground), as the sun's light reaches the surfaces of a scene. */
const SUN_REFERENCE_ALTITUDE = 0.5
/** Samples of the ray to the top of the air. */
const SUN_SAMPLES = 15

/**
 * The transmittance of the air from a point 500 m over the ground toward a sun whose direction
 * has height component `sine` (its elevation's sine), per colour channel: the ray from the point
 * to the top of the air, its optical depth summed over `SUN_SAMPLES` points. The elevation is not
 * less than `minSunElevation`; the planet's own shadow is not accounted for here — the sun below
 * the horizon crosses the planet's depth of air and goes dark.
 */
export function sunTransmittance(a: ResolvedAtmosphere, sine: number): Rgb {
  const k = coefficientsOf(a)
  const elevation = Math.max(a.minSunElevation * DEG2RAD, Math.asin(clamp(sine, -1, 1)))
  const direction: Rgb = [Math.cos(elevation), 0, Math.sin(elevation)]
  const origin: Rgb = [0, 0, k.bottomRadius + SUN_REFERENCE_ALTITUDE]
  const reach = nearestHit(origin, direction, k.topRadius)
  const depth = [0, 0, 0]
  if (reach > 0) {
    const step = reach / SUN_SAMPLES
    for (let i = 0; i < SUN_SAMPLES; i++) {
      const t = (reach * i) / SUN_SAMPLES
      const x = origin[0] + direction[0] * t,
        z = origin[2] + direction[2] * t
      const h = length2(x, z) - k.bottomRadius
      const mie = Math.max(0, Math.exp(k.mieExp * h)),
        rayleigh = Math.max(0, Math.exp(k.rayleighExp * h))
      const [slope, offset] = h < k.ozoneAltitude ? k.ozoneBelow : k.ozoneAbove
      const ozone = clamp(slope * h + offset, 0, 1)
      for (let c = 0; c < 3; c++)
        depth[c] +=
          step * (mie * k.mieExtinction[c] + rayleigh * k.rayleigh[c] + ozone * k.ozone[c])
    }
  }
  return [Math.exp(-depth[0]), Math.exp(-depth[1]), Math.exp(-depth[2])]
}

/** The solid angle of a disk of angular radius `halfApex`, steradians. */
export const diskSolidAngle = (halfApex: number) => TAU * (1 - Math.cos(halfApex))
