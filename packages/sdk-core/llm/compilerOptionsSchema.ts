import type { JsonSchemaObject } from './types.ts';

/**
 * JSON Schema documenting options for native asset compilation (prepare / CLI).
 */
export const COMPILER_OPTIONS_SCHEMA: JsonSchemaObject = {
  type: 'object',
  description:
    'Options for native web-geometry-compiler (FBX, OBJ, glTF to Nanite cluster DAG and hierarchical pages).',
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
      default: 2,
      minimum: 1,
      description:
        'Number of parallel worker threads allocated to the native compiler (default: 2).',
    },
    ramBudgetMb: {
      type: 'integer',
      default: 256,
      minimum: 64,
      description:
        'RAM memory budget allocated to the compiler in megabytes before admission rejection (default: 256).',
    },
    simplification: {
      type: 'string',
      enum: ['none', 'qem-endpoints', 'qem-attributes'],
      default: 'none',
      description:
        "LOD simplification strategy: 'none' (exact clusters only), 'qem-endpoints' (positional quadrics, coarse levels reuse source vertices) or 'qem-attributes' (attribute-aware quadrics, coarse levels carry solved vertices).",
    },
  },
  required: ['source', 'cache', 'resourceBaseUrl'],
  additionalProperties: false,
};
