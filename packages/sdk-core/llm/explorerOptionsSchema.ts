import type { JsonSchemaObject } from './types.ts';

/**
 * Comprehensive JSON Schema documenting all initialization options for the WebGeometry explorer (ExplorerOptions).
 * Enables LLMs to understand, validate, and tune the 3D engine configuration.
 */
export const EXPLORER_OPTIONS_SCHEMA: JsonSchemaObject = {
  type: 'object',
  description:
    'Initialization options for the WebGeometry rendering engine (createExplorer). Configures virtualized geometry (Nanite), temporal antialiasing (TAA), fixed GPU memory pools, dynamic lighting (Lumen), and virtual shadow maps.',
  properties: {
    interactive: {
      type: 'boolean',
      default: false,
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
        'Maximum ceiling to which the geometry pool can be dynamically enlarged by setMemoryBudgets.',
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
      default: true,
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
      default: false,
      description: 'Enables dynamic adaptation of LOD error threshold based on scene workload.',
    },
    shadowBudgetMs: {
      type: 'number',
      default: 1.0,
      minimum: 0.1,
      maximum: 16.0,
      description:
        'GPU time budget allocated per frame for redrawing virtual shadow map pages (in milliseconds). Default 1.0 ms.',
    },
    shadowPageInvalidation: {
      type: 'boolean',
      default: true,
      description:
        'Invalidation of shadow map pages per 128x128 page. false triggers redraw of entire cube/cascade faces.',
    },
    bounce: {
      type: 'boolean',
      default: false,
      description:
        'Dynamic global illumination (GI) via radiance probe bounce (Lumen-style). Incompatible with very tight GPU time budgets.',
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
      default: true,
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
      enum: ['certifiee', 'reference'],
      default: 'certifiee',
      description:
        "Screen-space error metric: 'certifiee' (rigorous bounded formula) or 'reference' (external projection formula).",
    },
    textureSource: {
      type: 'string',
      enum: ['host', 'cache'],
      default: 'host',
      description:
        "Texel source: 'host' (standard glTF decoding) or 'cache' (direct streaming from cooked mipmap pyramid).",
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
      default: false,
      description:
        'Static WebGL2 rendering of prepared pages without downloading full source geometry buffers.',
    },
    stageProfile: {
      type: 'boolean',
      default: false,
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
