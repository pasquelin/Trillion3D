import type { JsonSchemaObject } from './types.ts'
import { choiceOrFlag } from './schemaParts.ts'
import { ASSET_SCOPES, DEFAULT_SCOPE } from '../contracts/base.ts'
import { explorerSwitchDefault } from '../runtime/explorerSwitches.ts'
import { DEFAULT_PIXEL_ERROR } from '../lod/policy.ts'
import { DEFAULT_TEMPORAL_AA_LEVEL, TEMPORAL_AA_LEVELS } from '../contracts/compilerAbi.ts'
import {
  DEFAULT_GEOMETRY_POOL_BUDGET,
  DEFAULT_TEXTURE_POOL_BUDGET,
  LEAST_POOL_BUDGET,
} from '../contracts/poolBudgets.ts'
import {
  rasterProperties,
  settingRuleProperties,
  streamingProperties,
} from './settingProperties.ts'

/** The manifest, the asset scope and the memory pools of the explorer. */
const SESSION_OPTIONS = /* @__PURE__ */ (() =>
  ({
    // Each on/off default is the engine's own (`EXPLORER_SWITCHES`), read through a pure call so a
    // bundle that never reads the schema drops it.
    interactive: {
      type: 'boolean',
      default: explorerSwitchDefault('interactive'),
      description:
        'Browser-owned controls, CSS size, device pixel ratio and demand-driven rendering. Defaults to direct WebGPU; rejects when unavailable.',
    },
    manifestUrl: {
      type: 'string',
      description: 'Absolute or relative URL to the compiled scene manifest.json.',
    },
    scope: {
      type: 'string',
      enum: ASSET_SCOPES,
      default: DEFAULT_SCOPE,
      description: `Asset scope, one of the enum: '${DEFAULT_SCOPE}' by default.`,
    },
    geometryPoolBytes: {
      type: 'integer',
      default: DEFAULT_GEOMETRY_POOL_BUDGET,
      minimum: LEAST_POOL_BUDGET,
      description:
        'Size of the GPU geometry pool in bytes (default 512 MiB). Fixed memory allocated to streamed cluster pages; the root cover is held beside it, never in it. The least recently used pages give their slots to new ones; what does not fit draws coarser, without overflow.',
    },
    ...streamingProperties(),
    texturePoolBytes: {
      type: 'integer',
      default: DEFAULT_TEXTURE_POOL_BUDGET,
      minimum: LEAST_POOL_BUDGET,
      description:
        'Size of the virtual texture pool in bytes (default 512 MiB, split equally between color and data atlases).',
    },
    maxTextureUploadMsPerFrame: {
      type: 'number',
      default: 1.0,
      minimum: 0,
      maximum: 16.0,
      description:
        'CPU time budget per frame for copying virtual texture tiles into the pools (in milliseconds), besides the cap of 32 tiles a frame. Default 1.0 ms; tiles beyond it wait for the next frame and show their coarser level meanwhile.',
    },
  }) satisfies JsonSchemaObject['properties'])()

/** The antialiasing, the geometric error, the rasterizer, the settings and the bounce. */
const QUALITY_OPTIONS = /* @__PURE__ */ (() =>
  ({
    temporalAntialiasing: {
      ...choiceOrFlag(
        `Temporal antialiasing (TAA): Halton(2,3) sub-pixel jitter and reprojection accumulation, at a quality level (${TEMPORAL_AA_LEVELS.join(', ')}), ${DEFAULT_TEMPORAL_AA_LEVEL} by default. Disable ('off' or false) for pixel-exact benchmarks without history.`,
        TEMPORAL_AA_LEVELS,
        'A quality level.',
        `true ${DEFAULT_TEMPORAL_AA_LEVEL}, false off.`,
      ),
      default: DEFAULT_TEMPORAL_AA_LEVEL,
    },
    pixelError: {
      type: 'number',
      default: DEFAULT_PIXEL_ERROR,
      minimum: 0,
      description:
        'Screen-space error threshold in pixels for cluster LOD selection, the most pixels an edge of a coarser level may stray from the finer one. Default: 1. 0 = exact leaf clusters; 1 to 2 = standard reference fidelity; > 2 = aggressive simplification for low-end hardware.',
    },
    ...rasterProperties(),
    ...settingRuleProperties(),
    bounce: {
      type: 'boolean',
      default: explorerSwitchDefault('bounce'),
      description:
        'Dynamic global illumination (GI) via radiance probe bounce, which also carries the sky light the scene lets through. On by default; false turns it off. Incompatible with very tight GPU time budgets.',
    },
  }) satisfies JsonSchemaObject['properties'])()

/** The imported lights, the preloading, the diagnostics, the replicas and the clear colour. */
const SCENE_OPTIONS = /* @__PURE__ */ (() =>
  ({
    importedLights: {
      type: 'boolean',
      default: explorerSwitchDefault('importedLights'),
      description:
        'Enables lights imported from the source scene file. false opens the scene with zero lights.',
    },
    preload: {
      type: 'string',
      enum: ['visible', 'all'],
      default: 'visible',
      description:
        "Preloading mode: 'visible' (streams detail for current camera) or 'all' (eager full cover download).",
    },
    stageProfile: {
      type: 'boolean',
      default: explorerSwitchDefault('stageProfile'),
      description: 'Enables per-stage GPU/CPU timing accessible via explorer.stageProfile().',
    },
    diagnosticDetail: {
      type: 'string',
      enum: ['summary', 'trace'],
      default: 'summary',
      description:
        "Diagnostic verbosity: 'summary' (aggregate telemetry) or 'trace' (full per-frame scanning).",
    },
    replicaCount: {
      type: 'integer',
      enum: [1, 4, 9, 12],
      default: 1,
      description:
        'Number of instanced scene replicas (sharing underlying geometry and materials).',
    },
    clearColor: {
      type: 'integer',
      description: 'Clear color in 0xRRGGBB hexadecimal format (e.g., 0x000000 for pure black).',
    },
  }) satisfies JsonSchemaObject['properties'])()

/**
 * Comprehensive JSON Schema documenting all initialization options for the Trillion3D explorer (MeasuredWorldOptions).
 * Enables LLMs to understand, validate, and tune the 3D engine configuration. Built by a call
 * marked pure: its defaults read the settings, and a bundle that never reads the schema drops it.
 */
export const EXPLORER_OPTIONS_SCHEMA: JsonSchemaObject = /* @__PURE__ */ (() => ({
  type: 'object',
  description:
    'Initialization options for the Trillion3D rendering engine (openMeasuredWorld). Configures virtualized geometry (clusters streamed through a DAG), temporal antialiasing (TAA), fixed GPU memory pools, dynamic lighting, and virtual shadow maps.',
  properties: {
    ...SESSION_OPTIONS,
    ...QUALITY_OPTIONS,
    ...SCENE_OPTIONS,
  },
  required: ['manifestUrl'],
  additionalProperties: true,
}))()
