import type { AtmosphereSunIndex, LightMobility } from '../../scene/light/contracts.ts'
import type { LightUnits } from '../../scene/light/lightUnits.ts'
import type { LightingChannels } from '../../contracts/lightingChannelsAbi.ts'
import type { ColorInput } from '../math/color.ts'
import type { Vec3Input } from '../math/vector3.ts'
import type { LightFunctionParameters } from './lightFunctionSettings.ts'
import type { LightShaftParameters } from './lightShaftSettings.ts'
import type { LightCloudShadowParameters } from './lightCloudShadowSettings.ts'
import type { LightShadowParameters } from './lightShadowSettings.ts'
import type { LightContactShadowParameters } from './lightContactShadowSettings.ts'

/** What a page may pass to a light member. */
export interface LightParameters
  extends
    LightFunctionParameters,
    LightShaftParameters,
    LightCloudShadowParameters,
    LightShadowParameters,
    LightContactShadowParameters {
  /** The light's colour. */
  color?: ColorInput
  /** How strong the light is: lux for a directional light, a number in `intensityUnits` for a
   *  point, spot or rectangle light; absent, 10 lux for a directional light, 5000 unitless
   *  for a lamp, the light of 8 candelas written in its unit (an EV of 3, 8 candelas over its area
   *  in nits), 1 for the others. */
  intensity?: number
  /** The unit a point, spot or rectangle light's `intensity` is written in: `'unitless'` (the
   *  default), `'candelas'`, `'lumens'`, `'nits'` or `'ev'` (`LIGHT_UNITS`). */
  intensityUnits?: LightUnits
  /** Where the light stands. */
  position?: Vec3Input
  /** The point a directional or spot light shines at. */
  target?: Vec3Input
  /** Whether objects in this light cast shadows; on by default. */
  castShadow?: boolean
  /** How far a point or spot light reaches; 0 means no limit. */
  distance?: number
  /** How fast the light fades with distance; 2 is how real light fades. */
  decay?: number
  /** Half the opening of a spot light's inner cone, in radians: the light is whole inside it; 0 by
   *  default, full on the axis only. */
  innerConeAngle?: number
  /** Half the opening of a spot light's outer cone, in radians: the light fades to nothing at it,
   *  by the square of a ramp in the cosine from the inner cone; 44° by default. */
  outerConeAngle?: number
  /** The colour a hemisphere light gives from below. */
  groundColor?: ColorInput
  /** Width of a rectangle light, in metres; 0.64 by default. */
  width?: number
  /** Height of a rectangle light, in metres; 0.64 by default. */
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
  /** Whether a point or spot light falls off as the inverse square of the distance, windowed by
   *  `distance`; `true` by default. Off, it falls off by `distance` alone, as `radialExponent`. */
  inverseSquared?: boolean
  /** The exponent of a point or spot light's fall-off where `inverseSquared` is off: the light is
   *  one less the squared distance over the squared `distance`, to this power; 8 by default. */
  radialExponent?: number
  /** The share of its diffuse light the light gives, from 0 to 1; 1 by default. */
  diffuseShare?: number
  /** The share of its specular light the light gives, from 0 to 1; 1 by default. */
  specularShare?: number
  /** Point, spot and rect only: how much the light's strength is divided by the image's exposure, from 0 to 1: at 1 the
   *  light looks the same in a dark scene and a bright one; 0, its strength is kept whatever the exposure, by default. */
  inverseExposureBlend?: number
  /** Point, spot and rect only: the distance from a perspective view, in metres, past which the light is left out; 0, the default, no limit. */
  maxDrawDistance?: number
  /** Directional source angular radius, in radians. */
  angularRadius?: number
  /** Directional only: the soft angle of the source's disk, in degrees from 0 up to 180: it widens the highlight the sun leaves on a
   *  glossy surface without lighting more of the surface; 0 by default. */
  softAngle?: number
  /** How the four layers of the light's hair deep shadow are spread, from 0 to 1; 0.5 by default. */
  hairDeepShadowLayerDistribution?: number
  /** Whether a directional light may be the sun of the sky module's atmosphere (`scene.sky`):
   *  of the lights that may, the brightest is; `true` by default. */
  atmosphereSun?: boolean
  /** Which of the atmosphere's two lights a directional light may be, 0 or 1 (a sun and a moon, or
   *  two suns): the brightest of those that may be is held for each; 0 by default. */
  atmosphereSunIndex?: AtmosphereSunIndex
  /** Directional only: the light's priority for the one directional light the forward readers take
   *  (the translucent surfaces' cloud shade, the volumetric fog): a whole number of at least 0, the
   *  highest chosen, equals going to the brightest; 0 by default. */
  forwardShadingPriority?: number
  /** How much of the light the volumetric fog and the clouds scatter: 0 leaves it out of both; 1. */
  fogScattering?: number
  /** Whether the light's shadow also shadows the volumetric fog; a directional light's does. */
  shadowsFog?: boolean
  /** How the light is meant to move and be lit: `'static'`, `'stationary'` or `'movable'`;
   *  `'stationary'` by default. */
  mobility?: LightMobility
  /** The factor on the resolution a point, spot or rectangle light's shadow is given, 0 or more; 1
   *  by default. It acts on whether the light takes a shadow and how it fades: 0 takes it away. */
  shadowResolutionScale?: number
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
  /** Whether the light shines through the subsurface-profile surfaces it shadows; off by default,
   *  and acting on a movable light that casts a shadow alone. */
  transmission?: boolean
  /** Whether the light draws a deep shadow of the hair strands it reaches; off by default. */
  castHairDeepShadow?: boolean
  /** The lighting channels the light is in (`{ channel0, channel1, channel2 }`, each true or false): it
   *  lights an object's surfaces, and its shadow holds the object, only where they share a channel;
   *  channel 0 alone by default. */
  lightingChannels?: LightingChannels
  /** Directional only: the colour the sun's disk in the sky is multiplied by, linear; white by
   *  default. */
  sunDiskTint?: ColorInput
  /** A probe's irradiance: 27 numbers, nine RGB spherical-harmonic coefficients of the radiance
   *  in the band order constant, `y`, `z`, `x`, `xy`, `yz`, `3z² − 1`, `xz`, `x² − y²`, scaled by
   *  `intensity`; built by `emptyIrradiance` and the `add…Irradiance` helpers. Absent, the probe is
   *  uniform. */
  sh?: ArrayLike<number>
}
