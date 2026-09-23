import type { Trillion3DTool } from './types.ts';
import { EXPLORER_OPTIONS_SCHEMA } from './explorerOptionsSchema.ts';
import { COMPILER_OPTIONS_SCHEMA } from './compilerOptionsSchema.ts';

/**
 * Complete catalog of tools and runtime functions available to control trillion3D from an LLM.
 */
export const TRILLION3D_RUNTIME_TOOLS: Trillion3DTool[] = [
  {
    name: 'trillion3d_create_explorer',
    description: 'Initializes the trillion3D 3D explorer with specified rendering options.',
    parameters: EXPLORER_OPTIONS_SCHEMA,
  },
  {
    name: 'trillion3d_compile_asset',
    description:
      'Compiles a source 3D asset (FBX, OBJ, glTF) to the Nanite virtualized geometry format.',
    parameters: COMPILER_OPTIONS_SCHEMA,
  },
  {
    name: 'trillion3d_set_memory_budgets',
    description:
      'Dynamically adjusts GPU memory pools (virtualized geometry and virtual textures) during live execution.',
    parameters: {
      type: 'object',
      properties: {
        geometryPoolBytes: {
          type: 'integer',
          minimum: 67108864,
          description: 'New budget for the geometry pool in bytes (e.g., 268435456 for 256 MiB).',
        },
        texturePoolBytes: {
          type: 'integer',
          minimum: 67108864,
          description: 'New budget for the virtual texture pool in bytes.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'trillion3d_set_lod_error',
    description:
      'Adjusts the geometric screen-space error threshold in pixels to trade fidelity for performance.',
    parameters: {
      type: 'object',
      properties: {
        pixelError: {
          type: 'number',
          minimum: 0,
          description:
            'Threshold in pixels (0 = maximum visual fidelity without simplification, 1 to 2 = standard, > 2 = higher FPS).',
        },
      },
      required: ['pixelError'],
      additionalProperties: false,
    },
  },
  {
    name: 'trillion3d_set_temporal_antialiasing',
    description: 'Enables or disables temporal antialiasing (TAA).',
    parameters: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description:
            'true to enable temporal accumulation, false for instantaneous pixel-exact rendering.',
        },
      },
      required: ['enabled'],
      additionalProperties: false,
    },
  },
  {
    name: 'trillion3d_add_light',
    description: 'Adds a punctual point light, spot light, or directional sunlight into the scene.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the light.' },
        kind: {
          type: 'string',
          enum: ['point', 'spot', 'directional'],
          description: 'Light emitter type.',
        },
        color: {
          type: 'array',
          items: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Normalized linear RGB component.',
          },
          description: 'Linear RGB color [R, G, B] between 0 and 1.',
        },
        intensity: { type: 'number', minimum: 0, description: 'Radiometric light intensity.' },
        position: {
          type: 'array',
          items: { type: 'number', description: 'Spatial coordinate in meters.' },
          description:
            'Position [X, Y, Z] in meters (required for point and spot; forbidden for directional).',
        },
        direction: {
          type: 'array',
          items: { type: 'number', description: 'Normalized vector component.' },
          description: 'Propagation direction [X, Y, Z] (required for spot and directional).',
        },
        range: {
          type: 'number',
          minimum: 0.1,
          description: 'Maximum reach in meters (point and spot).',
        },
        coneAngle: {
          type: 'number',
          minimum: 0.01,
          maximum: 3.14,
          description: 'Half-angle beam spread in radians (spot).',
        },
        castsShadow: {
          type: 'boolean',
          default: false,
          description: 'Enables virtual shadow map casting.',
        },
      },
      required: ['id', 'kind', 'color', 'intensity'],
      additionalProperties: false,
    },
  },
  {
    name: 'trillion3d_remove_light',
    description: 'Removes a light source from the scene by its identifier.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identifier of the light to remove.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'trillion3d_set_diagnostic',
    description:
      'Activates an engine diagnostic mode to inspect underlying geometry, materials, or culling.',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: [
            'none',
            'wireframe',
            'cluster',
            'lod',
            'depth',
            'normal',
            'albedo',
            'roughness',
            'metalness',
            'ao',
          ],
          description: 'Technical diagnostic mode to display.',
        },
      },
      required: ['mode'],
      additionalProperties: false,
    },
  },
  {
    name: 'trillion3d_get_metrics',
    description:
      'Queries live telemetry metrics (FPS, resident cluster pages, visible triangles, shadow wait queues).',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];
