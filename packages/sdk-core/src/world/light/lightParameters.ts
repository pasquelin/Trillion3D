import type { AtmosphereSunIndex } from '../../scene/light/contracts.ts'
import type { ShadowDistanceOption } from '../../contracts/shadowOptions.ts'
import type { ColorInput } from '../math/color.ts'
import type { Vec3Input } from '../math/vector3.ts'
import type { LightFunctionParameters } from './lightFunctionSettings.ts'
import type { LightShaftParameters } from './lightShaftSettings.ts'
import type { LightCloudShadowParameters } from './lightCloudShadowSettings.ts'

/** What a page may pass to a light member. */
export interface LightParameters
  extends LightFunctionParameters, LightShaftParameters, LightCloudShadowParameters {
  /** The light's colour. */
  color?: ColorInput
  /** How strong the light is. */
  intensity?: number
  /** Where the light stands. */
  position?: Vec3Input
  /** The point a directional or spot light shines at. */
  target?: Vec3Input
  /** Whether objects in this light cast shadows. */
  castShadow?: boolean
  /** How far a point or spot light reaches; 0 means no limit. */
  distance?: number
  /** How fast the light fades with distance; 2 is how real light fades. */
  decay?: number
  /** Half the opening of a spot light's cone, in radians. */
  angle?: number
  /** How soft a spot light's edge is, from 0 (sharp) to 1. */
  penumbra?: number
  /** The colour a hemisphere light gives from below. */
  groundColor?: ColorInput
  /** Width of a rectangle light. */
  width?: number
  /** Height of a rectangle light. */
  height?: number
  /** Radius of the emitting sphere of a point or spot light: its soft shadow's size, and how the
   *  lamp lights a surface — the horizon wraps a sphere, a highlight spreads. */
  radius?: number
  /** Length of the tube a point or spot light is, in metres, along the light's own up (its local
   *  y); 0, the default, a sphere or a point. With a `radius` the lamp is a capsule. */
  tubeLength?: number
  /** Soft radius of a point or spot light, in metres: it widens the highlight the lamp leaves
   *  without lighting more of the surface; 0 by default. */
  softRadius?: number
  /** Directional source angular radius, in radians. */
  angularRadius?: number
  /** How far from the eye, in metres, a directional light's shadows are asked to reach, scaled by
   *  the view's `shadowDistanceScale`: `true` or nothing 400, `false` none. The far-shadow test's
   *  edge lies a little past it (427.0 at the defaults, the last near level's overlap into the next):
   *  a caster whose depth along the view, less its radius, is past the edge, and whose object does
   *  not set `castFarShadow`, is left out of the light's shadows. By default the test reaches the
   *  world's merged far-field shells alone; the view's `farShadowCullsAllMeshes` makes it reach
   *  every caster. */
  shadowDistance?: ShadowDistanceOption
  /** Whether a directional light may be the sun of the sky module's atmosphere (`scene.sky`):
   *  of the lights that may, the brightest is; `true` by default. */
  atmosphereSun?: boolean
  /** Which of the atmosphere's two lights a directional light may be, 0 or 1 (a sun and a moon, or
   *  two suns): the brightest of those that may be is held for each; 0 by default. */
  atmosphereSunIndex?: AtmosphereSunIndex
  /** How much of the light the volumetric fog and the clouds scatter: 0 leaves it out of both; 1. */
  fogScattering?: number
  /** Whether the light's shadow also shadows the volumetric fog; a directional light's does. */
  shadowsFog?: boolean
  /** Whether the light's colour is multiplied by the colour of a black body at `temperatureKelvin`;
   *  off by default. */
  useTemperature?: boolean
  /** The black body's temperature in kelvin, read between 1000 and 15000; 6500, white, by default. */
  temperatureKelvin?: number
  /** Directional only: whether the light's shadow also shades the air (the haze and the sky's
   *  march read it along their rays); off by default. */
  shadowsAir?: boolean
  /** Directional only: whether the air's transmittance toward the light is read for each surface
   *  point and not once at the ground; off by default. */
  transmittancePerPixel?: boolean
  /** Directional only: the colour the sun's disk in the sky is multiplied by, linear; white by
   *  default. */
  sunDiskTint?: ColorInput
  /** A probe's irradiance: 27 numbers, nine RGB spherical-harmonic coefficients of the radiance
   *  in the band order constant, `y`, `z`, `x`, `xy`, `yz`, `3z² − 1`, `xz`, `x² − y²`, scaled by
   *  `intensity`; built by `emptyIrradiance` and the `add…Irradiance` helpers. Absent, the probe is
   *  uniform. */
  sh?: ArrayLike<number>
}
