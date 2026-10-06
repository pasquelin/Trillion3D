// Shared shapes of the harness measurement: what `series/series.ts` builds, `bench.ts` assembles into
// `measure.json`, and everything under `bench/runner/` (`summary/summary.ts`, `summary/summaryCompute.ts`,
// `summary/summaryMemory.ts`, `summary/summaryTextures.ts`, `report/`) reads back. One record type here, typed
// once from the engine contracts, rather than cast at every reader.
import type {
  CameraPose,
  FrameMetrics,
  StageProfile,
} from '../../../packages/sdk-core/src/index.ts';
import type { MemoryBudgetsReport } from '../../../packages/sdk-browser/src/index.ts';
import type { Distribution, PassesGpu } from '../summary/summaryPasses.ts';
import type { BenchSettings } from '../harness/options.ts';
import type { Bounds } from '../trajectory/poses.ts';
import type { LightsPlan } from '../lighting/lamps.ts';
import type { LimitsRecord } from '../harness/limits.ts';
import type { FluidsRow } from '../fluids/fluids.ts';
import type { GazeNetworkReading } from '../gaze/gazeNetworkRun.ts';

/** What `bench.ts` builds before playing series, and `series/series.ts` reads to run one. */
export interface RunContext {
  MANIFEST: string | null;
  OUT: string;
  settings: BenchSettings;
  lights: LightsPlan | null;
  poses: CameraPose[] | null;
  bounds?: Bounds;
}

/** The selected cut of a series, read inside the page (`series/cutPage.ts`). */
export interface CutSelection {
  source: string | null;
  ids: string[];
}

/** Contract occlusion counters, under their own names; `image` names the frame they describe. */
interface HiZCounters {
  tested: number | null;
  rejected: number | null;
  beyond16Texels: number | null;
  testedTriangles: number | null;
  rejectedTriangles: number | null;
  beyond16TexelsTriangles: number | null;
  image: number | null;
}

/** The page budget as the last frame saw it (`series/seriesPools.ts`). */
export interface PageBudget {
  requested: number | null;
  resident: number | null;
  budgetLimitedCoverage: boolean | null;
}

/** The geometry pool as the engine held it (`series/seriesPools.ts`). */
export interface GeometryPool {
  bytes: number | null;
  slots: number | null;
  allocated: number | null;
  bound: string | null;
  saturated: number | null;
}

/** In-session reservoir tuning report, plus the frames the pose took to hold again, the texture
 *  budget asked, and the resident bytes a pool asked as a fraction of the working set came from. */
export type LiveTuning = MemoryBudgetsReport & {
  recoveryFrames: number | null;
  texturePoolAskedBytes?: number;
  residentTextureBytes?: number;
};

/** Bytes transferred on the network since a reading, by file kind. */
export type NetworkBytes = Record<string, number>;

/** A moving node's own report: what it moved, or why it could not. */
export type MovingNode =
  { node: string; radius: number; images: number } | { node: string; error: string } | null;

/** One reported page error: an uncaught page error, an HTTP failure, or a console error. */
type PageError =
  | { kind: 'pageerror'; message: string }
  | { kind: 'http'; status: number; url: string }
  | { kind: 'console'; message: string }
  | { kind: 'cut-analysis'; message: string }
  | { kind: 'black-capture'; message: string };

/** A generic-rule light placement summary (`lighting/lamps.ts`), for `measure.json` and `resume.md`. */
export interface LightsSummary {
  count: number;
  points: number;
  sun: boolean;
  shadows: boolean;
  grid: number;
  intensity: number;
  range: number;
  mobile: boolean;
}

/** Delta between two RGBA captures (`references/imageDiff.ts::imageDiff`). */
export type ImageDiff =
  | null
  | { error: string }
  | { pixels: number; maxChannel: number; meanChannel: number; p999Channel: number; total: number };

/** One row of the series table: one side, one view, one threshold (`series/series.ts::runSerie`). */
export interface Row {
  cpuFrameMs: Distribution;
  cpuSelectMs: Distribution;
  engine: string;
  gpuFrameMs: Distribution;
  imageSyncMs: Distribution;
  rafIntervalMs: Distribution;
  stageProfile: StageProfile | null;
  passesGpu: PassesGpu | null;
  preparationMs: number | null;
  settleFrames: number | null;
  liveTuning: LiveTuning | null;
  network: NetworkBytes | null;
  variant: string | null;
  errorMetric: string;
  selectedTriangles: number | null;
  uncoveredTriangles: number | null;
  drawnTriangles: number | null;
  submittedTriangles: number | null;
  totalSubmittedTriangles: number | null;
  recordedFrame: number | null;
  frameHeld: boolean | null;
  gpuSelectionFallback: boolean | null;
  hiZ: HiZCounters;
  selection: { source: CutSelection['source']; sha256: string | null; count: number };
  geometryBytes: number | null;
  pageBudget: PageBudget;
  geometryPool: GeometryPool;
  mathBatch: FrameMetrics['mathBatch'] | null;
  lights: LightsSummary | null;
  importedLights: { count: number; ids: string[] } | null;
  witnessLights: unknown;
  movingNode: MovingNode;
  load: { start: number[]; end: number[] };
  png: string | null;
  captureStatus: number;
  gpuIncidents: string[] | null;
  dagWarnings: unknown;
  cpuBounds: unknown;
  canvas: { width: number; height: number; dpr?: number };
  metrics: Partial<FrameMetrics> & Record<string, unknown>;
  cutAnalysis?: unknown;
}

/** One series: one view, one threshold, every side's row. */
export interface Series {
  view: string;
  pixelError: number;
  segment: string;
  index: number;
  pose: CameraPose;
  sides: Record<string, Row>;
  witnessAA?: ImageDiff;
  beforeAfterDiff?: ImageDiff;
  /** Each side's capture against the engine's reference image (`--reference`, class 2). */
  referenceDiff?: Record<string, import('../references/imageDiff.ts').ReferenceDiff>;
  sameCut?: boolean | null;
}

/** What a side publishes about itself in the report: dist, cache, engine, variant. */
interface SideIdentity {
  dist: string;
  from: string;
  cache: string | null;
  engine: string;
  variant: string | null;
  errorMetric: string;
  assetKey?: string;
  buildHash?: string;
}

/** The whole harness report: `measure.json`, built by `bench.ts` and read by `summary/summary.ts`. */
export interface Report {
  startedAt: string;
  provenance: { machine: unknown; browser: unknown; displayCapHz: number | null };
  campaignIdentity: string | null;
  command: string;
  head: string;
  scene: string;
  engine: string;
  pathVersion: number;
  settings: BenchSettings & { port?: number };
  flags: string[];
  resources: string | null;
  sides: Record<string, SideIdentity>;
  series: Series[];
  gazeNetwork?: GazeNetworkReading[];
  errors: PageError[];
  bounds?: Bounds;
  lights?: LightsSummary | null;
  /** The browser limits, probed once per run (`harness/limits.ts`). */
  limits?: LimitsRecord;
  /** One row per side on the fluids scene (`fluids/fluids.ts`). */
  fluids?: FluidsRow[];
  finishedAt?: string;
}
