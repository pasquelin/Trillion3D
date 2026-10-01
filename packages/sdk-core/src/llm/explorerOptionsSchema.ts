import type { JsonSchemaObject } from './types.ts';
import { SCREEN_ERROR_VARIANTS } from '../lod/screenErrorVariants.ts';
import { explorerSwitchDefault } from '../runtime/explorerSwitches.ts';

/**
 * Comprehensive JSON Schema documenting all initialization options for the Trillion3D explorer (MeasuredWorldOptions).
 * Enables LLMs to understand, validate, and tune the 3D engine configuration.
 */
export const EXPLORER_OPTIONS_SCHEMA: JsonSchemaObject = {
  type: 'object',
  description:
    'Initialization options for the Trillion3D rendering engine (openMeasuredWorld). Configures virtualized geometry (clusters streamed through a DAG), temporal antialiasing (TAA), fixed GPU memory pools, dynamic lighting, and virtual shadow maps.',
  properties: {
    // Each on/off default is the engine's own (`EXPLORER_SWITCHES`), read through a pure call so a
    // bundle that never reads the schema drops it.
    interactive: {
      type: 'boolean',
      default: /* @__PURE__ */ explorerSwitchDefault('interactive'),
      description:
        'Browser-owned controls, CSS size, device pixel ratio and demand-driven rendering. Defaults to direct WebGPU; rejects when unavailable.',
    },
    manifestUrl: {
      type: 'string',
      description: 'Absolute or relative URL to the compiled scene manifest.json.',
    },
    scope: {
      type: 'string',
      enum: ['slice', 'full'],
      default: 'slice',
      description: "Asset scope: 'slice' (default) or 'full'.",
    },
    geometryPoolBytes: {
      type: 'integer',
      default: 536870912,
      minimum: 67108864,
      description:
        'Size of the GPU geometry pool in bytes (default 512 MiB = 536870912). Fixed memory allocated to cluster pages. Non-visible pages are evicted or streamed at coarser LOD without overflow.',
    },
    geometryPoolCeilingBytes: {
      type: 'integer',
      description:
        'Geometry pool ceiling for setMemoryBudgets: the WebGL2 engine never enlarges the pool past it; the WebGPU engine sizes its drawable-page tables to it and grows them in place past it.',
    },
    texturePoolBytes: {
      type: 'integer',
      default: 536870912,
      minimum: 67108864,
      description:
        'Size of the virtual texture pool in bytes (default 512 MiB, split equally between color and data atlases).',
    },
    maxTextureUploadMsPerFrame: {
      type: 'number',
      default: 1.0,
      minimum: 0,
      maximum: 16.0,
      description:
        'CPU time budget per frame for copying virtual texture tiles into the pools (in milliseconds). Default 1.0 ms; tiles beyond it wait for the next frame and show their coarser level meanwhile.',
    },
    temporalAntialiasing: {
      type: 'boolean',
      default: /* @__PURE__ */ explorerSwitchDefault('temporalAntialiasing'),
      description:
        'Temporal antialiasing (TAA) enabled by default: Halton(2,3) sub-pixel jitter and reprojection accumulation. Disable (false) for pixel-exact benchmarks without history.',
    },
    pixelError: {
      type: 'number',
      default: 0,
      minimum: 0,
      description:
        'Screen-space error threshold in pixels for cluster LOD selection. 0 = exact leaf clusters; 1 to 2 = standard reference fidelity; > 2 = aggressive simplification for low-end hardware.',
    },
    lodAdaptive: {
      type: 'boolean',
      default: /* @__PURE__ */ explorerSwitchDefault('lodAdaptive'),
      description: 'Enables dynamic adaptation of LOD error threshold based on scene workload.',
    },
    shadowPageInvalidation: {
      type: 'boolean',
      default: /* @__PURE__ */ explorerSwitchDefault('shadowPageInvalidation'),
      description:
        'Invalidation of shadow map pages per 128x128 page. false stales every page of each light a moving object touches.',
    },
    shadowLocalToClip: {
      type: 'boolean',
      default: /* @__PURE__ */ explorerSwitchDefault('shadowLocalToClip'),
      description:
        'Shadow casters placed by a LocalToClip matrix stored once per caster and light view, one matrix-vector product per vertex. Off by default: depths may differ by one ulp from the default path.',
    },
    shadowPoolPages: {
      type: 'integer',
      default: 4096,
      minimum: 1,
      description:
        'Physical pages of the shadow pool (128x128 texels, 64 KiB each), allocated once when a light first casts and never resized. Default 4096 (256 MiB). A frame that reads more pages draws the coarser level past it.',
    },
    bounce: {
      type: 'boolean',
      default: /* @__PURE__ */ explorerSwitchDefault('bounce'),
      description:
        'Dynamic global illumination (GI) via radiance probe bounce. Incompatible with very tight GPU time budgets.',
    },
    bounceBudgetMs: {
      type: 'number',
      default: 0.8,
      minimum: 0.1,
      maximum: 8.0,
      description:
        'Target GPU budget in milliseconds for the radiance bounce stage. Default 0.8 ms.',
    },
    importedLights: {
      type: 'boolean',
      default: /* @__PURE__ */ explorerSwitchDefault('importedLights'),
      description:
        'Enables lights imported from the source scene file. false opens the scene with zero lights.',
    },
    mathPath: {
      type: 'string',
      enum: ['auto', 'js', 'wasm'],
      default: 'auto',
      description:
        "Execution path for batch mathematical operations: 'auto' (automatic governor arbitration), 'js', or 'wasm' (WebAssembly).",
    },
    screenError: {
      type: 'string',
      enum: SCREEN_ERROR_VARIANTS,
      default: 'certifiee',
      description:
        "Screen-space error metric: 'certifiee' (rigorous bounded formula) or 'reference' (external projection formula).",
    },
    textureSource: {
      type: 'string',
      enum: ['host', 'cache'],
      default: 'cache',
      description:
        "Whether the prepared scene reads the source images: 'cache' (skipped, the engine reads the baked levels) or 'host' (decoded too, for a backend that draws the host scene). The engine reads the baked levels either way, and falls back to 'host' by itself where a mounted backend samples the host images.",
    },
    preload: {
      type: 'string',
      enum: ['visible', 'all'],
      default: 'visible',
      description:
        "Preloading mode: 'visible' (streams detail for current camera) or 'all' (eager full cover download).",
    },
    autonomousGeometry: {
      type: 'boolean',
      default: /* @__PURE__ */ explorerSwitchDefault('autonomousGeometry'),
      description:
        'Static WebGL2 rendering of prepared pages without downloading full source geometry buffers.',
    },
    stageProfile: {
      type: 'boolean',
      default: /* @__PURE__ */ explorerSwitchDefault('stageProfile'),
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
  },
  required: ['manifestUrl'],
  additionalProperties: true,
};
