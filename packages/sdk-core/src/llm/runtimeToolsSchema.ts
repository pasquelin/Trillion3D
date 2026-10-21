import type { Trillion3dTool } from './types.ts'
import { EXPLORER_OPTIONS_SCHEMA } from './explorerOptionsSchema.ts'
import { COMPILER_OPTIONS_SCHEMA } from './compilerOptionsSchema.ts'
import { LEAST_POOL_BUDGET } from '../contracts/poolBudgets.ts'
import { DIAGNOSTICS, type DiagnosticMode } from '../runtime/diagnostics.ts'
import { RASTER_RULES } from '../contracts/rasterOptions.ts'
import { STREAMING_RULES } from '../contracts/streamingOptions.ts'
import { WORLD_STREAMING_RULES } from '../contracts/worldStreamingOptions.ts'
import { CUT_RULES } from '../contracts/cutOptions.ts'
import { ANIMATION_RULES } from '../contracts/animationOptions.ts'
import { SHADING_RULES } from '../contracts/shadingOptions.ts'

/** A tool that writes the run-time settings of the rules by field `rules`, each as the explorer's
 *  options describe it (`EXPLORER_OPTIONS_SCHEMA`). Each call is marked pure, so a bundle that
 *  never reads the tools drops them. */
const settingTool = (
  name: string,
  description: string,
  rules: Readonly<Record<string, unknown>>,
): Trillion3dTool => ({
  name,
  description,
  parameters: {
    type: 'object',
    properties: Object.fromEntries(
      Object.keys(rules).map((field) => [field, EXPLORER_OPTIONS_SCHEMA.properties[field]!]),
    ),
    additionalProperties: false,
  },
})

/** The view modes this engine can show: the others `setDiagnostic` refuses. Pure, so a bundle
 *  that never reads the tools drops it. */
const AVAILABLE_DIAGNOSTICS = /* @__PURE__ */ (Object.keys(DIAGNOSTICS) as DiagnosticMode[]).filter(
  (mode) => DIAGNOSTICS[mode].available,
)

/**
 * Complete catalog of tools and runtime functions available to control Trillion3D from an LLM.
 */
export const TRILLION3D_RUNTIME_TOOLS: Trillion3dTool[] = [
  {
    name: 'trillion3d_create_explorer',
    description: 'Initializes the Trillion3D explorer with specified rendering options.',
    parameters: EXPLORER_OPTIONS_SCHEMA,
  },
  {
    name: 'trillion3d_compile_asset',
    description:
      'Compiles a source 3D asset (FBX, OBJ, glTF) to the virtualized cluster geometry format.',
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
          minimum: LEAST_POOL_BUDGET,
          description: 'New budget for the geometry pool in bytes (e.g., 268435456 for 256 MiB).',
        },
        texturePoolBytes: {
          type: 'integer',
          minimum: LEAST_POOL_BUDGET,
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
  /* @__PURE__ */ settingTool(
    'trillion3d_set_raster',
    'Chooses which rasterizer draws each cluster from the next frame: the compute (software) raster for clusters whose edges project small, the hardware rasterizer for the others.',
    RASTER_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_streaming',
    'Changes how the geometry streaming runs from its next update: the pages it keeps started at once, the pages a frame installs, and how the streaming pool load scales the screen error.',
    STREAMING_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_world_streaming',
    "Changes from the next frame how the view streams a partitioned scene's cells (how many load at once, their load order, the streaming circle's range or radius, a sector) and the warm-up an HLOD switch waits on.",
    WORLD_STREAMING_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_cut',
    "Changes from the next frame how the GPU cluster cut culls: its two-pass occlusion against the depth pyramid, its frustum and too-coarse culls, and how an upscaled image's level of detail follows the display.",
    CUT_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_animation',
    "Changes from the next frame the animation the GPU plays: the screen size under which an instanced skinned object stops animating and is drawn in its rest pose, whether the animation banks' tracks blend their two nearest keys, and the scale of the world's seconds they advance by.",
    ANIMATION_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_shading',
    "Changes from the next frame how the material pass bins each material's pixels before shading them: by pixel or by 2 × 2 quad, or as each material's shading asks. The image is the same in each mode.",
    SHADING_RULES,
  ),
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
          // The engine refuses a half-angle of π/2 or more (`scene/light/validate.ts`); an inclusive
          // bound below π/2 keeps to the subset every provider reads (no `exclusiveMaximum`).
          maximum: 1.57,
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
          enum: AVAILABLE_DIAGNOSTICS,
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
]
