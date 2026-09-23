// The payload `serie.ts` sends into the page, and the result `measureView` (`pageEclairage.ts`)
// sends back. One shape on each side of the `page.evaluate` boundary, read by both the Node
// harness and the browser page module — hence type-only imports here, erased at build.
import type {
  CameraPose,
  FrameMetrics,
  GpuPassTimings,
  StageProfile,
} from '../../packages/sdk-core/src/index.ts';
import type { SceneLight } from '../../packages/sdk-core/src/scene/light/contracts.ts';
import type { ScreenErrorVariant } from '../../packages/sdk-core/src/index.ts';
import type { TextureCompression } from '../../packages/sdk-browser/textureBlockFormats.ts';
import type { MovingLightPlan } from './lampes.ts';
import type { Coupe, MovingNode, ReglageVivant, Reseau } from './report/types.ts';

/** What `runSerie` sends into the page: everything `measureView` needs, nothing it infers. */
export interface MeasureViewOptions {
  sdkUrl: string;
  manifestUrl: string;
  backend: string | null;
  engineId: string;
  autonomous: boolean;
  modulesUrl: string;
  witness: boolean;
  page: string;
  gltfUrl: string | null;
  pose: CameraPose;
  poses: CameraPose[] | null;
  captureFile: string;
  pixelError: number;
  frames: number;
  warmup: number;
  maxPages: number | null;
  geometryPoolBytes: number | null;
  texturePoolBytes: number | null;
  geometryPoolCeilingBytes: number | null;
  poolVivant: { geometryPoolBytes?: number | null; texturePoolBytes?: number | null } | null;
  instances: number;
  width: number;
  height: number;
  stageProfile: boolean;
  variant: string | null;
  errorMetric: ScreenErrorVariant | null;
  trace: boolean;
  bounce: boolean;
  importedLights: boolean;
  profileFrames: number;
  lights: SceneLight[];
  moving: MovingLightPlan | null;
  shadowBudgetMs: number | null;
  shadowPages: boolean;
  shadowDigest: boolean;
  textureSource: 'cache' | 'host';
  textureUploadMs: number | null;
  /** Block format asked of the texture pools; `undefined` leaves the engine's own choice. */
  textureCompression: TextureCompression | undefined;
  temporalAntialiasing: boolean;
  mathPath: 'js' | 'wasm' | null;
  movingNode: string | null;
  movingNodeRadius: number;
}

/** What `measureView` returns for one series, when it managed to open the engine. */
interface MeasureViewSuccess {
  erreur?: undefined;
  cpuFrameMs: number[];
  cpuSelectMs: number[];
  gpuFrameMs: number[];
  syncFrameMs?: number[];
  rafIntervalMs: number[];
  importedLights: { nombre: number; ids: string[] } | null;
  lampesTemoin: unknown;
  shadowAtlas: unknown;
  movingNode: MovingNode;
  stageProfile: StageProfile | null;
  gpuPassSamples: GpuPassTimings[];
  selection: Coupe;
  metrics: Partial<FrameMetrics> & Record<string, unknown>;
  preparationMs: number;
  network: Reseau;
  // Absent from the Three witnesses (`pageThreeMesure.ts`): they have no reservoir tuning, no
  // held-pose loop, no compiler warnings and no per-step CPU profile of their own.
  imagesCalme?: number | null;
  reglageVivant?: ReglageVivant | null;
  mathBatch: FrameMetrics['mathBatch'] | null;
  size: { width: number; height: number; dpr?: number };
  lost: string[];
  avertissementsDag?: unknown;
  bornesCpu?: unknown;
  captureStatus: number;
}

/** The engine named by `backend` is missing from this dist: nothing was measured. */
interface MeasureViewFailure {
  erreur: string;
}

export type MeasureViewResult = MeasureViewFailure | MeasureViewSuccess;
