import type { JsonSchemaObject, JsonSchemaProperty } from './types.ts'
import { ASSET_SCOPES, DEFAULT_SCOPE } from '../contracts/base.ts'
import {
  DEFAULT_HLOD_LEVELS,
  DEFAULT_HLOD_TEXTURE_SIZE,
  DEFAULT_HLOD_VOXEL_PIXELS,
  DEFAULT_RAM_BUDGET_MB,
  DEFAULT_SIMPLIFICATION,
  DEFAULT_TEMPORAL_AA_LEVEL,
  HLOD_BUILDERS,
  HLOD_FIELD,
  HLOD_LOD_SELECTIONS,
  HLOD_MARK,
  MAX_HLOD_LEVELS,
  MAX_HLOD_TEXTURE_SIZE,
  MAX_THREADS,
  MIN_HLOD_LEVELS,
  MIN_HLOD_TEXTURE_SIZE,
  MIN_RAM_BUDGET_MB,
  MATERIALS_FIELD,
  RESPONSIVE_EXTRA,
  RESPONSIVE_FIELD,
  SIMPLIFICATIONS,
  TEMPORAL_AA_EXTRA,
  TEMPORAL_AA_FIELD,
  TEMPORAL_AA_LEVELS,
  TEMPORAL_AA_SHARES,
  type HlodLayer,
  type JobField,
} from '../contracts/compilerAbi.ts'
import { DEFAULT_HLOD_QUALITY, HLOD_GROUPS, HLOD_QUALITIES } from '../contracts/hlodOptions.ts'
import { DEFAULT_PIXEL_ERROR } from '../lod/policy.ts'

/** One property for each compile job field (`JOB_FIELDS`), no more and no fewer. */
const properties: Record<JobField, JsonSchemaProperty> = {
  source: {
    type: 'string',
    description:
      'Absolute or relative path to source 3D file (.gltf, .glb, .fbx, .obj) or model directory.',
  },
  cache: {
    type: 'string',
    description: 'Target cache directory where compiled manifest and binary pages are written.',
  },
  scope: {
    type: 'string',
    enum: ASSET_SCOPES,
    default: DEFAULT_SCOPE,
    description: "Asset export scope: 'slice' streams the model in pages, 'full' keeps it whole.",
  },
  triangleBudget: {
    type: 'integer',
    minimum: 1,
    description: 'Maximum triangle budget to retain. Omit to preserve full source geometry.',
  },
  threads: {
    type: 'integer',
    minimum: 1,
    maximum: MAX_THREADS,
    description:
      'Number of parallel worker threads allocated to the native compiler. Omit to use every core of the machine.',
  },
  ramBudgetMb: {
    type: 'integer',
    default: DEFAULT_RAM_BUDGET_MB,
    minimum: MIN_RAM_BUDGET_MB,
    description:
      'RAM memory budget allocated to the compiler in megabytes before admission rejection (see default).',
  },
  resourceBaseUrl: {
    type: 'string',
    description: 'Base HTTP URL from which the browser serves baked resources and textures.',
  },
  simplification: {
    type: 'string',
    enum: SIMPLIFICATIONS,
    default: DEFAULT_SIMPLIFICATION,
    description:
      "LOD simplification strategy: 'qem-endpoints' (quadric error metrics QEM, coarser levels for distance) or 'none' (exact clusters only, every triangle drawn at any distance).",
  },
}

/** A regular expression as the compiler reads it. */
const regex: JsonSchemaProperty = {
  type: 'object',
  description: 'A regular expression: its source, and its flags (i, m, s).',
  properties: {
    regex: { type: 'string', description: 'The source, as in /source/.' },
    flags: { type: 'string', description: 'The flags: i, m, s.' },
  },
  required: ['regex'],
}

/** A name to match: a string the exact name, `{ regex, flags }` a regular expression. */
const pattern = (what: string): JsonSchemaProperty => ({
  description: `${what}: a string is the exact name, { regex, flags } a regular expression.`,
  anyOf: [{ type: 'string', description: 'The exact name.' }, regex],
})

/** What a rule matches; every field named must match, and one naming none is refused. */
const match: JsonSchemaProperty = {
  type: 'object',
  description: 'What the rule matches on the glTF; every field named must match, at least one.',
  properties: {
    node: pattern("The node's name"),
    mesh: pattern("Its mesh's name"),
    material: pattern("One of its primitives' material names"),
    extras: {
      type: 'object',
      description:
        "Values the node's extras must hold: { regex, flags } for a string, else the exact value.",
    },
  },
}

/** A positive number: strictly above zero, as the compiler checks it. */
const positive = (description: string): JsonSchemaProperty => ({
  type: 'number',
  description: `${description} Strictly positive.`,
})

/** A quality preset's settings (`HLOD_QUALITIES`). */
type HlodQualityPreset = Pick<HlodLayer, 'deviationPixels' | 'textureSize'>

/** What a quality preset sets on every approximated layer, in words (`HLOD_QUALITIES`). */
const preset = ([quality, { deviationPixels, textureSize }]: [string, HlodQualityPreset]) =>
  `${quality} (deviation ${deviationPixels ?? DEFAULT_PIXEL_ERROR} px, ${textureSize ?? DEFAULT_HLOD_TEXTURE_SIZE}-texel atlas)`

/** The `hlod` option, either form (`hlodOptions.ts`, `resolveHlod`). */
const hlod: JsonSchemaProperty = {
  type: 'object',
  description: `The world's HLOD, as HLOD layers, in one of two forms, never both. Simple form: levels, quality, groups. Expert form: layers, assign, default. Only the objects a glTF node's extras.${HLOD_MARK} mark names — a group or a layer, by name — or a group or rule matches enter an HLOD actor, the mark first; omit it for no HLOD.`,
  properties: {
    levels: {
      type: 'integer',
      minimum: MIN_HLOD_LEVELS,
      maximum: MAX_HLOD_LEVELS,
      default: DEFAULT_HLOD_LEVELS,
      description: "Simple form: the main chain's levels, HLOD 0 included.",
    },
    quality: {
      type: 'string',
      enum: Object.keys(HLOD_QUALITIES),
      default: DEFAULT_HLOD_QUALITY,
      description: `Simple form: ${Object.entries(HLOD_QUALITIES).map(preset).join(', ')}, on every approximated layer.`,
    },
    groups: {
      type: 'object',
      description: `Simple form, the objects of each group by name, for those no mark names: ${HLOD_GROUPS.join(', ')} — buildings the main chain, foliage two levels with a finer voxel, props their own instanced cells absorbed by the main chain's first approximated layer. Each the node's exact name, { regex, flags } on it, or a match object; the first group in key order that matches an object takes it, and an object no group names has no HLOD.`,
      properties: Object.fromEntries(
        HLOD_GROUPS.map((group) => [
          group,
          {
            description: `The objects of ${group}.`,
            anyOf: [{ type: 'string', description: "The node's exact name." }, regex, match],
          },
        ]),
      ),
    },
    layers: {
      type: 'array',
      description: 'Expert form: the layers.',
      items: {
        type: 'object',
        description:
          'One layer. A setting is given in metres or in pixels, not both; a builder refuses the settings of another.',
        required: ['name', 'builder'],
        properties: {
          name: { type: 'string', description: 'Unique name.' },
          builder: {
            type: 'string',
            enum: HLOD_BUILDERS,
            description: 'How it builds its actors.',
          },
          parent: {
            type: 'string',
            description: "The layer its cells' actors are built by; none at a chain's top.",
          },
          accuracy: positive("An approximate or proxy layer's voxel, metres."),
          accuracyPixels: positive(
            `Its voxel, pixels at the distance the layer is first seen from (default ${DEFAULT_HLOD_VOXEL_PIXELS}).`,
          ),
          deviation: positive(
            "An approximate or merge layer's geometric deviation, metres: what an approximated shell is simplified within, the LOD a merged layer takes of each source.",
          ),
          deviationPixels: positive(`Its deviation, pixels (default ${DEFAULT_PIXEL_ERROR}).`),
          textureSize: {
            type: 'integer',
            minimum: MIN_HLOD_TEXTURE_SIZE,
            maximum: MAX_HLOD_TEXTURE_SIZE,
            description: `The atlas side of an approximate or proxy layer, or of a merge layer merging its materials, a power of two (default ${DEFAULT_HLOD_TEXTURE_SIZE}).`,
          },
          lodSelection: {
            type: 'string',
            enum: HLOD_LOD_SELECTIONS,
            description: `A merge layer's LOD of each source: the coarsest its deviation holds from the distance it is first seen from, or its coarsest (default ${HLOD_LOD_SELECTIONS[0]}).`,
          },
          mergeMaterials: {
            type: 'boolean',
            description:
              "Whether a merge layer merges its sources' materials into one atlas (default false: each section wears its source's material).",
          },
        },
      },
    },
    assign: {
      type: 'array',
      description:
        'Expert form: the rules assigning objects to instanced layers; the first that matches wins.',
      items: {
        type: 'object',
        description: 'One rule.',
        required: ['match', 'layer'],
        properties: { match, layer: { type: 'string', description: 'An instanced layer.' } },
      },
    },
    default: {
      type: 'string',
      description:
        'Expert form: the instanced layer of an object no rule matches (default none: such an object has no HLOD).',
    },
  },
}

/** The `temporalAntialiasing` option (`materialOptions.ts`, `resolveTemporalAntialiasing`), built by
 *  a call marked pure, as the material options below: each reads the levels and the shares, and a
 *  bundle that never reads the schema drops it. */
const temporalAntialiasing: JsonSchemaProperty = /* @__PURE__ */ (() => ({
  description: `The scene's temporal anti-aliasing quality level, written in its manifest: the runtime's scene setting, below the quality preset, the page and the editor; the first loaded scene naming it decides. true is ${DEFAULT_TEMPORAL_AA_LEVEL}, false is off. Default none: the runtime's own, ${DEFAULT_TEMPORAL_AA_LEVEL}.`,
  anyOf: [
    { type: 'string', enum: [...TEMPORAL_AA_LEVELS], description: 'A quality level.' },
    { type: 'boolean', description: `true ${DEFAULT_TEMPORAL_AA_LEVEL}, false off.` },
  ],
}))()

/** The `responsive` option (`materialOptions.ts`, `resolveResponsive`). */
const responsive: JsonSchemaProperty = /* @__PURE__ */ (() => ({
  description: `The objects whose materials keep a responsive temporal anti-aliasing history (at most ${TEMPORAL_AA_SHARES.responsive} of it, the current image weighing at least a quarter), for fast effects such as sparks: the node's exact name, { regex, flags } on it, or a match object; a match naming material keeps only those materials. Below materials, above a material's own extras.${TEMPORAL_AA_EXTRA} and extras.${RESPONSIVE_EXTRA}.`,
  anyOf: [{ type: 'string', description: "The node's exact name." }, regex, match],
}))()

/** The `materials` option (`materialOptions.ts`, `resolveMaterials`), the named shares listed. */
const materials: JsonSchemaProperty = /* @__PURE__ */ (() => {
  const names = Object.entries(TEMPORAL_AA_SHARES)
    .map(([name, share]) => `'${name}' (${share})`)
    .join(', ')
  return {
    type: 'object',
    description: `Settings by exact material name, each { temporalAntialiasing, responsive }, winning over responsive and the extras. temporalAntialiasing is the most of its history the temporal anti-aliasing keeps on its pixels: a number from 0 to 1 or one of ${names}; default 1. responsive: true is ${TEMPORAL_AA_SHARES.responsive}; false takes the material out of the responsive option and its extras.${RESPONSIVE_EXTRA}. A material's own glTF extras.${TEMPORAL_AA_EXTRA} names its share below the responsive option.`,
  }
})()

/**
 * JSON Schema documenting options for native asset compilation (prepare / CLI): the job fields,
 * defaults and bounds `compilerAbi.ts` declares once, which the compiler's Rust is printed from,
 * the HLOD (`hlod`), the scene's temporal anti-aliasing (`temporalAntialiasing`) and the material
 * options (`responsive`, `materials`).
 */
export const COMPILER_OPTIONS_SCHEMA: JsonSchemaObject = {
  type: 'object',
  description:
    'Options for native trillion3d-compiler (FBX, OBJ, glTF to a cluster DAG and hierarchical pages).',
  properties: {
    ...properties,
    [HLOD_FIELD]: hlod,
    [TEMPORAL_AA_FIELD]: temporalAntialiasing,
    [RESPONSIVE_FIELD]: responsive,
    [MATERIALS_FIELD]: materials,
  },
  required: ['source', 'cache', 'resourceBaseUrl'] satisfies JobField[],
  additionalProperties: false,
}
