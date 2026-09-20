import type * as THREE from 'three';
import type {
  AssetScope,
  CameraPose,
  MathPathMode,
  PreparationProgress,
  ScreenErrorVariant,
} from '../sdk-core/index.ts';
import type { ComparisonLayout } from './comparison.ts';
import type { BackendDiagnostic, BackendFactory, DiagnosticDetail } from './backendTypes.ts';
import type { DiagnosticGpuVariant } from './diagnosticGpuVariant.ts';

export type PointOfInterest = { id: string; label: string; pose: CameraPose };
export interface ExplorerOptions {
  /** Own controls, CSS/DPR sizing and demand-driven rendering. Off by default.
   *  Defaults to direct WebGPU; a missing capability rejects startup. */
  interactive?: boolean;
  replicaCount?: 1 | 4 | 9 | 12;
  detail?: 'source' | 'maximum';
  onEvent?: (event: import('../sdk-core/index.ts').RuntimeEvent) => void;
  manifestUrl: string;
  scope?: AssetScope;
  signal?: AbortSignal;
  width?: number;
  height?: number;
  fov?: number;
  pixelRatio?: number;
  pageFetchWorkers?: number;
  maxPageTransferBytes?: number;
  onPreparation?: (event: PreparationProgress) => void;
  backends?: BackendFactory[];
  maxResidentPages?: number;
  maxCachedPages?: number;
  /** Resident page/bundle bytes kept by the streamer. Defaults to DEFAULT_CACHED_BYTES. */
  maxCachedBytes?: number;
  pixelError?: number;
  lodAdaptive?: boolean;
  /** Presentation clear color supplied by the host, encoded as 0xRRGGBB. */
  clearColor?: number;
  /** Bounded diagnostics emitted by a backend and owned by the host report. */
  onDiagnostic?: (diagnostic: BackendDiagnostic) => void;
  /** Summary suppresses per-frame trace records; trace is the default with an observer. */
  diagnosticDetail?: DiagnosticDetail;
  preload?: 'visible' | 'all';
  /** Render static prepared pages without requesting the full source geometry buffer. */
  autonomousGeometry?: boolean;
  comparisonLayout?: ComparisonLayout;
  comparisonPair?: [string, string];
  gpu?: GPU;
  pointsOfInterest?: PointOfInterest[];
  /** Texture-tile bytes the WebGPU engine admits per frame; 16 MiB by default. */
  maxTextureTransferBytesPerFrame?: number;
  /** CPU milliseconds the WebGPU engine may spend copying texture tiles per frame; 1.0 by
   *  default. Tiles beyond it wait for the next frame, shown meanwhile by their coarser
   *  resident level; the worst pass is published as `textureUploadPeakMs`. */
  maxTextureUploadMsPerFrame?: number;
  /** Geometry-page pool bytes of the WebGPU engine — streamed geometry memory, regardless
   *  of the scene, like the reference's 512 MB pool. 512 MiB by default. The root cover
   *  always fits; what a view asks beyond that draws coarser, never refused. Set during
   *  the session by `explorer.setMemoryBudgets`. */
  geometryPoolBytes?: number;
  /** Largest geometry pool `explorer.setMemoryBudgets` may ask for during the session —
   *  the maximum of a settings slider. The starting budget without it. */
  geometryPoolCeilingBytes?: number;
  /** Virtual-texture pool bytes of the WebGPU engine — texture memory, regardless of the
   *  scene. 512 MiB by default, split equally between the colour atlas and the data atlas,
   *  in 63.5 MiB layers; under one layer per atlas the pool is raised to one, by name. What
   *  a view asks beyond that waits for a less-looked-at tile to free, and a missing tile
   *  shows its coarse level: the `textureTiles*` metrics publish it. Set during the session
   *  by `explorer.setMemoryBudgets`. */
  texturePoolBytes?: number;
  /** Temporal antialiasing of the WebGPU engine, on by default as in the reference: each
   *  frame is rendered with a fraction-of-a-pixel jitter and accumulated over the previous
   *  ones, reprojected. `false` renders the image sampled at the pixel centre, with no
   *  history — that is the "before" of a comparison, and what pixel-for-pixel benches ask. */
  temporalAntialiasing?: boolean;
  /** Where material texels come from. `'host'`, the default: the glTF loader reads and
   *  decodes every source image, as always — that is what an engine that draws the host
   *  scene (the Three witness) requires. `'cache'`: an image whose mip chain is baked in
   *  the cache is neither read nor decoded, the WebGPU engine reads its levels one by one
   *  when the screen asks. Only request when every engine of the session reads the atlas,
   *  not the scene. */
  textureSource?: 'host' | 'cache';
  sceneLighting?: THREE.Object3D;
  /** Bounced light. Off by default; `true` turns it on for the whole session. */
  bounce?: boolean;
  /** Target duration of the "Bounce" step per frame, in milliseconds. 0.8 ms by default. */
  bounceBudgetMs?: number;
  /** Time every step of the frame and publish `explorer.stageProfile()`. Off by default. */
  stageProfile?: boolean;
  /** A GPU DIAGNOSTIC variant (`diagnosticGpuVariant.ts`): it neutralises a factor of the
   *  frame to split its duration, and therefore renders an image different from production.
   *  Absent by default; refused outside `diagnosticDetail: 'trace'`. */
  diagnosticGpuVariant?: DiagnosticGpuVariant;
  /** Shadows-step budget, in GPU milliseconds per frame. 1.0 by default: invalidated pages
   *  beyond that wait their turn, never lost, their lag published. */
  shadowBudgetMs?: number;
  /** Page-by-page shadow-map invalidation. On by default; `false` restarts the whole face
   *  as soon as an object moves in its range, as before the virtualized-shadows batch. */
  shadowPageInvalidation?: boolean;
  /** Declare the lights the source file carried, read from the cache. On by default: an
   *  imported scene arrives with its lights. `false` opens the scene with none of them. */
  importedLights?: boolean;
  /** Path of batched compute operations: `'auto'` by default, measurement arbitrating
   *  between reference JavaScript and the WebAssembly module. `'js'` or `'wasm'` impose it
   *  for a campaign; `'wasm'` falls back on `'js'` where the module is missing, and says so
   *  in the metrics. */
  mathPath?: MathPathMode;
  /** Measurement EXPERIENCE (`sdk-core/screenErrorVariant.ts`): the cluster screen-error
   *  metric. `'certifiee'` by default, ours; `'reference'` puts the simple projection of the
   *  external reference, CPU and GPU to the same result to f32. */
  screenError?: ScreenErrorVariant;
  logInterval?: number;
}
