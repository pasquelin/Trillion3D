import { ASSET_SCOPES, DEFAULT_SCOPE } from '../contracts/base.ts'
import {
  DEFAULT_RAM_BUDGET_MB,
  DEFAULT_SIMPLIFICATION,
  HLOD_FIELD,
  MATERIALS_FIELD,
  MAX_THREADS,
  MESH_BUILD_FIELD,
  MIN_RAM_BUDGET_MB,
  OBJECT_SETTINGS_FIELD,
  PARTITION_GRID_FIELD,
  RESPONSIVE_FIELD,
  SIMPLIFICATIONS,
  TEMPORAL_AA_FIELD,
  VOXELIZE_FIELD,
  type JobField,
} from '../contracts/compilerAbi.ts'
import { PARTITION_SCHEME_FIELD } from '../contracts/partitionOptions.ts'
import { hlod } from './hlodSchema.ts'
import { materials, responsive, temporalAntialiasing, voxelize } from './materialSchema.ts'
import { meshBuild } from './meshBuildSchema.ts'
import { objectSettings } from './objectSchema.ts'
import { partitionGrid, partitionScheme } from './partitionSchema.ts'
import type { JsonSchemaObject, JsonSchemaProperty } from './types.ts'

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

/**
 * JSON Schema documenting options for native asset compilation (prepare / CLI): the job fields,
 * defaults and bounds `compilerAbi.ts` declares once, which the compiler's Rust is printed from,
 * the HLOD (`hlodSchema.ts`), the scene's temporal anti-aliasing (`temporalAntialiasing`), the
 * material options (`responsive`, `materials`) and the voxelized objects (`voxelize`), all in
 * `materialSchema.ts`, the partition's scheme and main grid (`partitionSchema.ts`), the mesh build
 * settings (`meshBuildSchema.ts`) and the object settings (`objectSchema.ts`). Built by a call
 * marked pure, as the pieces it reads are: a bundle that never reads the schema drops all of them.
 */
export const COMPILER_OPTIONS_SCHEMA: JsonSchemaObject = /* @__PURE__ */ (() => ({
  type: 'object',
  description:
    'Options for native trillion3d-compiler (FBX, OBJ, glTF to a cluster DAG and hierarchical pages).',
  properties: {
    ...properties,
    [HLOD_FIELD]: hlod,
    [TEMPORAL_AA_FIELD]: temporalAntialiasing,
    [RESPONSIVE_FIELD]: responsive,
    [MATERIALS_FIELD]: materials,
    [VOXELIZE_FIELD]: voxelize,
    [PARTITION_SCHEME_FIELD]: partitionScheme,
    [PARTITION_GRID_FIELD]: partitionGrid,
    [MESH_BUILD_FIELD]: meshBuild,
    [OBJECT_SETTINGS_FIELD]: objectSettings,
  },
  required: ['source', 'cache', 'resourceBaseUrl'] satisfies JobField[],
  additionalProperties: false,
}))()
