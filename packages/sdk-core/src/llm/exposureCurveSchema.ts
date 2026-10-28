import {
  EXTRAPOLATIONS,
  INTERPOLATIONS,
  TANGENT_MODES,
  WEIGHT_MODES,
} from '../contracts/exposureCurve.ts'
import type { JsonSchemaProperty } from './types.ts'
import { num } from './schemaParts.ts'

const extrapolation = (what: string): JsonSchemaProperty => ({
  type: 'string',
  enum: [...EXTRAPOLATIONS],
  description: `What the curve does ${what} its keys; 'constant' (held) by default.`,
})

const keyObject: JsonSchemaProperty = /* @__PURE__ */ (() => ({
  type: 'object',
  description: 'A key with its settings.',
  properties: {
    ev: num('The EV100 of the key.'),
    compensation: num('The stops added there.'),
    interpolation: {
      type: 'string',
      enum: [...INTERPOLATIONS],
      description: 'How the key runs to the next; linear by default.',
    },
    tangentMode: {
      type: 'string',
      enum: [...TANGENT_MODES],
      description: "How the tangents are set; 'auto' by default.",
    },
    weightMode: {
      type: 'string',
      enum: [...WEIGHT_MODES],
      description:
        "Which tangents carry a weight, the length of the tangent's handle; 'none' by default.",
    },
    arriveTangent: num('The tangent arriving at the key.'),
    leaveTangent: num('The tangent leaving the key.'),
    arriveWeight: num('The weight of the tangent arriving at the key; 0 by default.'),
    leaveWeight: num('The weight of the tangent leaving the key; 0 by default.'),
  },
  required: ['ev', 'compensation'],
}))()

const keys: JsonSchemaProperty = /* @__PURE__ */ (() => ({
  type: 'array',
  description: 'The keys, in any order.',
  items: {
    anyOf: [
      {
        type: 'array',
        items: num('EV100 first, then the stops added there.'),
        minItems: 2,
        maxItems: 2,
        description: 'A key [ev, compensation], linear to the next.',
      },
      keyObject,
    ],
    description: 'A key.',
  },
}))()

/** The schema of a curve option (`../contracts/exposureCurve.ts`) described by `description`. */
const curveProperty = (description: string): JsonSchemaProperty => ({
  anyOf: [
    keys,
    {
      type: 'object',
      description: 'The keys with how the curve runs before the first and after the last.',
      properties: { keys, before: extrapolation('before'), after: extrapolation('after') },
      required: ['keys'],
    },
    { type: 'boolean', description: 'false: no curve.' },
  ],
  description,
})

/** The schema of the explorer's `exposureCurve` option. */
export const exposureCurveProperty = (): JsonSchemaProperty =>
  curveProperty(
    'Exposure compensation curve of the automatic exposure: stops added to its target by how bright the scene is. A key sits at an EV100 (the mean luminance over middle grey, one stop a doubling) and gives the stops added there (0 none, -1 twice as dark, 1 twice as bright). Baked into a 64-sample table over EV100 -10 to +20. None by default; set later by explorer.setExposureCurve.',
  )

/** The schema of the explorer's local exposure contrast curve options: `which` is 'highlight' or 'shadow'. */
export const contrastCurveProperty = (which: 'highlight' | 'shadow'): JsonSchemaProperty =>
  curveProperty(
    `Curve of the local exposure's ${which} contrast: a key sits at an EV100 (the mean luminance over middle grey, one stop a doubling) and gives the scale the ${which} contrast (local exposure ${which} contrast setting) is multiplied by there; the 'compensation' of a key is that scale, not stops. Baked into a 64-sample table over EV100 -10 to +20. None by default (scale 1); set later by explorer.setLocalExposure${which === 'highlight' ? 'Highlight' : 'Shadow'}ContrastCurve.`,
  )
