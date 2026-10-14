import type { JsonSchemaObject, JsonSchemaProperty } from './types.ts'
import { ASSET_SCOPES, DEFAULT_SCOPE } from '../contracts/base.ts'
import {
  DEFAULT_RAM_BUDGET_MB,
  DEFAULT_THREADS,
  MAX_THREADS,
  MIN_RAM_BUDGET_MB,
  SIMPLIFICATIONS,
  type JobField,
} from '../contracts/compilerAbi.ts'

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
    default: DEFAULT_THREADS,
    minimum: 1,
    maximum: MAX_THREADS,
    description:
      'Number of parallel worker threads allocated to the native compiler (see default).',
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
    default: SIMPLIFICATIONS[0],
    description:
      "LOD simplification strategy: 'none' (no simplification) or 'qem-endpoints' (quadric error metrics QEM).",
  },
}

/**
 * JSON Schema documenting options for native asset compilation (prepare / CLI): the job fields,
 * defaults and bounds `compilerAbi.ts` declares once, which the compiler's Rust is printed from.
 */
export const COMPILER_OPTIONS_SCHEMA: JsonSchemaObject = {
  type: 'object',
  description:
    'Options for native trillion3d-compiler (FBX, OBJ, glTF to a cluster DAG and hierarchical pages).',
  properties,
  required: ['source', 'cache', 'resourceBaseUrl'] satisfies JobField[],
  additionalProperties: false,
}
