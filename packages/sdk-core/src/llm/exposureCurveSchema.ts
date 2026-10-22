import type { JsonSchemaProperty } from './types.ts'
import { num } from './schemaParts.ts'

const MODES = ['cycle', 'cycleWithOffset', 'oscillate', 'linear', 'constant', 'none']

const extrapolation = (what: string): JsonSchemaProperty => ({
  type: 'string',
  enum: MODES,
  description: `What the curve does ${what} its keys; 'constant' (held) by default.`,
})

const keyObject: JsonSchemaProperty = {
  type: 'object',
  description: 'A key with its settings.',
  properties: {
    ev: num('The EV100 of the key.'),
    compensation: num('The stops added there.'),
    interpolation: {
      type: 'string',
      enum: ['linear', 'constant', 'cubic'],
      description: 'How the key runs to the next; linear by default.',
    },
    tangentMode: {
      type: 'string',
      enum: ['auto', 'user', 'break', 'none', 'smartAuto'],
      description: "How the tangents are set; 'auto' by default.",
    },
    arriveTangent: num('The tangent arriving at the key.'),
    leaveTangent: num('The tangent leaving the key.'),
  },
  required: ['ev', 'compensation'],
}

const keys: JsonSchemaProperty = {
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
}

/** The schema of the explorer's `exposureCurve` option (`../contracts/exposureCurve.ts`). */
export const exposureCurveProperty = (): JsonSchemaProperty => ({
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
  description:
    'Exposure compensation curve of the automatic exposure: stops added to its target by how bright the scene is. A key sits at an EV100 (the mean luminance over middle grey, one stop a doubling) and gives the stops added there (0 none, -1 twice as dark, 1 twice as bright). Baked into a 64-sample table over EV100 -10 to +20. None by default; set later by explorer.setExposureCurve.',
})
