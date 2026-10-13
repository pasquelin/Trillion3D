import type { JsonSchemaObject } from './types.ts'
import { DEFAULT_RAM_BUDGET_MB, DEFAULT_THREADS } from '../contracts/compilerAbi.ts'

/**
 * JSON Schema documenting options for native asset compilation (prepare / CLI).
 */
export const COMPILER_OPTIONS_SCHEMA: JsonSchemaObject = {
  type: 'object',
  description:
    'Options for native trillion3d-compiler (FBX, OBJ, glTF to a cluster DAG and hierarchical pages).',
  properties: {
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
      enum: ['slice', 'full'],
      default: 'slice',
      description: "Asset export scope: 'slice' (default) or 'full'.",
    },
    resourceBaseUrl: {
      type: 'string',
      description: 'Base HTTP URL from which the browser serves baked resources and textures.',
    },
    triangleBudget: {
      type: 'integer',
      description: 'Maximum triangle budget to retain. Omit to preserve full source geometry.',
    },
    threads: {
      type: 'integer',
      default: DEFAULT_THREADS,
      minimum: 1,
      description:
        'Number of parallel worker threads allocated to the native compiler (see default).',
    },
    ramBudgetMb: {
      type: 'integer',
      default: DEFAULT_RAM_BUDGET_MB,
      minimum: 64,
      description:
        'RAM memory budget allocated to the compiler in megabytes before admission rejection (see default).',
    },
    simplification: {
      type: 'string',
      enum: ['none', 'qem-endpoints'],
      default: 'none',
      description:
        "LOD simplification strategy: 'none' (no simplification) or 'qem-endpoints' (quadric error metrics QEM).",
    },
  },
  required: ['source', 'cache', 'resourceBaseUrl'],
  additionalProperties: false,
}
