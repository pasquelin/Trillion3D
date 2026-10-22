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
import { DEFAULT_HLOD_GROUP, HLOD_GROUPS } from '../contracts/hlodOptions.ts'
import { hlodLayers } from './hlodLayerSchema.ts'
import { match, nameOrMatch } from './schemaParts.ts'
import type { JsonSchemaProperty } from './types.ts'

/** The `hlod` option, either form (`hlodOptions.ts`, `resolveHlod`). Built by a call marked pure: a
 *  bundle that never reads the schema drops it. */
export const hlod: JsonSchemaProperty = /* @__PURE__ */ (() => ({
  type: 'object',
  description: `The world's HLOD, as HLOD layers, in one of two forms, never both. Simple form: levels, groups, default. Expert form: layers, assign, default. An object enters the layer a glTF node's extras.${HLOD_MARK} mark names — a group or a layer, by name —, else the first group or rule that matches it, else the default; omit it for no HLOD. A node whose extras.${HLOD_INSTANCE_MARK} is true stands as itself in every actor its chain builds; one whose extras.${HLOD_INCLUDE_MARK} is false enters no layer, whatever a mark, a rule or the default gives it.`,
  properties: {
    levels: {
      type: 'integer',
      minimum: MIN_HLOD_LEVELS,
      maximum: MAX_HLOD_LEVELS,
      default: DEFAULT_HLOD_LEVELS,
      description:
        "Simple form: the main chain's levels, HLOD 0 included — the objects themselves, then one merged level after another; one level is the objects themselves, always loaded.",
    },
    groups: {
      type: 'object',
      description: `Simple form, the objects of each group by name, for those no mark names: ${HLOD_GROUPS.join(', ')} — buildings the main chain, foliage two levels, the objects themselves then their cells voxelized together (no shell, a leaf's cut-out kept), their meshes voxelized far away, props their own instanced cells absorbed by the main chain's first merged layer (always loaded when the main chain has one level). Each the node's exact name, { regex, flags } on it, or a match object; the first group in key order that matches an object takes it, and an object no group names goes to the default group. Each chain's grids double their cell (from ${DEFAULT_HLOD_CELL_SIZE} m) and range (from ${DEFAULT_HLOD_LOADING_RANGE} m) level after level, its last level always loaded.`,
      properties: Object.fromEntries(
        HLOD_GROUPS.map((group) => [group, nameOrMatch(`The objects of ${group}.`)]),
      ),
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
      description: `Simple form: the group of an object neither a mark nor a group names, one of ${HLOD_GROUPS.join(', ')}, or none to leave it out of every HLOD actor (default ${DEFAULT_HLOD_GROUP}). Expert form: the layer of an object no rule matches (default none: such an object has no HLOD).`,
    },
  },
}))()
