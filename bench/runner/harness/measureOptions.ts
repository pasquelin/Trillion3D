// The payload `series/series.ts` sends into the page, and the result `measureView` (`lighting/lightingPage.ts`)
// sends back. One shape on each side of the `page.evaluate` boundary, read by both the Node
// harness and the browser page module — hence type-only imports here, erased at build.
import type {
  CameraPose,
  FrameMetrics,
  GpuPassTimings,
  StageProfile,
} from '../../../packages/sdk-core/src/index.ts';
import type { SceneLight } from '../../../packages/sdk-core/src/scene/light/contracts.ts';
import type { ScreenErrorVariant } from '../../../packages/sdk-core/src/index.ts';
import type { TextureCompression } from '../../../packages/sdk-browser/src/texture/blockFormats.ts';
import type { MovingLightPlan } from '../lighting/lamps.ts';
import type { CutSelection, MovingNode, LiveTuning, NetworkBytes } from '../report/types.ts';
import type { LivePools } from './benchSettings.ts';

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
  livePools: LivePools | null;
  instances: number;
  width: number;
  height: number;
  pixelRatio: number;
  stageProfile: boolean;
  variant: string | null;
  errorMetric: ScreenErrorVariant | null;
  trace: boolean;
  bounce: boolean;
  importedLights: boolean;
  profileFrames: number;
  lights: SceneLight[];
  moving: MovingLightPlan | null;
  textureSource: 'cache' | 'host';
  textureUploadMs: number | null;
  /** Block format asked of the texture pools; `undefined` leaves the engine's own choice. */
  textureCompression: TextureCompression | undefined;
  /** Fraction of the display per axis the frame is drawn at; `undefined` leaves the display's. */
  renderScale?: number;
  temporalAntialiasing: boolean;
  mathPath: 'js' | 'wasm' | null;
  movingNode: string | null;
  movingNodeRadius: number;
}

/** What `measureView` returns for one series, when it managed to open the engine. */
interface MeasureViewSuccess {
  error?: undefined;
  cpuFrameMs: number[];
  cpuSelectMs: number[];
  gpuFrameMs: number[];
  /** Device idle before a sampled image, from its neighbour's last timestamp, one reading per
   *  sampled image that carries one (#1451): read beside `gpuFrameMs`, from the same run. */
  gpuIdleMs?: number[];
  syncFrameMs?: number[];
  rafIntervalMs: number[];
  importedLights: { count: number; ids: string[] } | null;
  witnessLights: unknown;
  movingNode: MovingNode;
  stageProfile: StageProfile | null;
  gpuPassSamples: GpuPassTimings[];
  selection: CutSelection;
  metrics: Partial<FrameMetrics> & Record<string, unknown>;
  preparationMs: number;
  network: NetworkBytes;
  // Absent from the Three witnesses (`witness/threeMeasurePage.ts`): they have no reservoir tuning, no
  // held-pose loop, no compiler warnings and no per-step CPU profile of their own.
  settleFrames?: number | null;
  liveTuning?: LiveTuning | null;
  mathBatch: FrameMetrics['mathBatch'] | null;
  size: { width: number; height: number; dpr?: number };
  lost: string[];
  dagWarnings?: unknown;
  cpuBounds?: unknown;
  captureStatus: number;
}

/** The engine named by `backend` is missing from this dist: nothing was measured. */
interface MeasureViewFailure {
  error: string;
}

export type MeasureViewResult = MeasureViewFailure | MeasureViewSuccess;
