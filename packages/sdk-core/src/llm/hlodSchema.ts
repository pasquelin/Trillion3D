import {
  DEFAULT_HLOD_CELL_SIZE,
  DEFAULT_HLOD_LEVELS,
  DEFAULT_HLOD_LOADING_RANGE,
  HLOD_INCLUDE_MARK,
  HLOD_INSTANCE_MARK,
  HLOD_MARK,
  MAX_HLOD_LEVELS,
  MIN_HLOD_LEVELS,
} from '../contracts/compilerAbi.ts'
import { hlodLayers } from './hlodLayerSchema.ts'
import { match } from './schemaParts.ts'
import type { JsonSchemaProperty } from './types.ts'

/** The `hlod` option, either form (`hlodOptions.ts`, `resolveHlod`). Built by a call marked pure: a
 *  bundle that never reads the schema drops it. */
export const hlod: JsonSchemaProperty = /* @__PURE__ */ (() => ({
  type: 'object',
  description: `The world's HLOD, as a list of HLOD layers — each its builder and the layer its cells' actors are built by —, in one of two forms, never both. Simple form: levels, default. Expert form: layers, assign, default. An object enters the layer a glTF node's extras.${HLOD_MARK} mark names, by name, else the first rule that matches it, else the default; omit it for no HLOD. A node whose extras.${HLOD_INSTANCE_MARK} is true stands as itself in every actor its chain builds; one whose extras.${HLOD_INCLUDE_MARK} is false enters no layer, whatever a mark, a rule or the default gives it.`,
  properties: {
    levels: {
      type: 'integer',
      minimum: MIN_HLOD_LEVELS,
      maximum: MAX_HLOD_LEVELS,
      default: DEFAULT_HLOD_LEVELS,
      description: `Simple form: the chain's levels, HLOD 0 included — the objects themselves (layer hlod0), then one merged level after another (hlod1 and up) —, each level's grid doubling its cell (from ${DEFAULT_HLOD_CELL_SIZE} m) and its range (from ${DEFAULT_HLOD_LOADING_RANGE} m), its last level always loaded; one level is the objects themselves, always loaded.`,
    },
    layers: hlodLayers,
    assign: {
      type: 'array',
      description:
        'Expert form: the rules assigning objects to layers, whose actors are then their HLOD 0; the first that matches wins.',
      items: {
        type: 'object',
        description: 'One rule.',
        required: ['match', 'layer'],
        properties: { match, layer: { type: 'string', description: 'A layer.' } },
      },
    },
    default: {
      type: 'string',
      description:
        'Simple form: none, to leave an object no mark names out of every HLOD actor; left out, it enters hlod0. Expert form: the layer of an object no rule matches (default none: such an object has no HLOD).',
    },
  },
}))()
