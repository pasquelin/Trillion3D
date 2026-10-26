import { LIGHT_SETTINGS } from '../scene/light/contracts.ts'
import { DEFAULT_INNER_CONE_ANGLE } from '../scene/light/fields.ts'
import { DEFAULT_LIGHT_UNITS, LIGHT_UNITS } from '../scene/light/lightUnits.ts'
import { lightShadowProperties } from './lightShadowSchema.ts'
import type { JsonSchemaProperty } from './types.ts'

/** The light tool's parameters of a spot's cone and of how a lamp falls off and how much of its
 *  light it gives (`SceneLight`, `../scene/light/contracts.ts`), each with the default the light
 *  takes when it names none. */
function lampProperties(): Record<string, JsonSchemaProperty> {
  return {
    intensityUnits: {
      type: 'string',
      enum: [...LIGHT_UNITS],
      default: DEFAULT_LIGHT_UNITS,
      description:
        "Point and spot only: the unit the intensity is written in; unitless by default. candelas, a luminous intensity; lumens, a flux spread over the point's sphere or the spot's cone; nits, a luminance times the area of the source's sphere or capsule (none without an emitterRadius); ev, an exposure value at ISO 100, 2 to that power candelas; unitless, 16 candelas for every 10 000.",
    },
    innerConeAngle: {
      type: 'number',
      minimum: 0,
      maximum: 1.57,
      default: DEFAULT_INNER_CONE_ANGLE,
      description:
        'Spot only: the half-angle in radians of the cone inside which the light is whole; it fades to nothing at the outer cone, by the square of a ramp in the cosine between the two. 0, the default, fades across the whole cone; an inner cone as wide as the outer one fades only across a milliradian at its edge.',
    },
    inverseSquared: {
      type: 'boolean',
      default: true,
      description:
        'Point and spot only: whether the light falls off as the inverse square of the distance, windowed to nothing at its range; false falls off by the range alone, as radialExponent says, with no distance weight.',
    },
    radialExponent: {
      type: 'number',
      exclusiveMinimum: 0,
      default: LIGHT_SETTINGS.radialExponent,
      description:
        'Point and spot only, where inverseSquared is false: the exponent the light is one less the squared share of its range to; greater is a tighter pool.',
    },
    diffuseShare: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      default: 1,
      description:
        "The share of this light's diffuse light the surfaces take, and of its transmission through a thin surface and of the light it gives the bounce; 0 gives them none.",
    },
    specularShare: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      default: 1,
      description:
        "The share of this light's specular light the surfaces take; 0 leaves the highlight out.",
    },
  }
}

/** The light tool's parameters that are not its basics, the sun's shadow settings and the lamps'. */
export const lightProperties = () => ({ ...lampProperties(), ...lightShadowProperties() })
