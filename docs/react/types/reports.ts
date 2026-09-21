import type { METRICS } from '../../js/reports/metrics.js';
import type { REPORT_VERSION, RUN_STATUSES } from '../../js/reports/contract.js';

/** The report file is the boundary: `assertReport` checks it, these shapes describe what it holds. */
export type RunStatus = (typeof RUN_STATUSES)[number];

export type MetricKey = keyof typeof METRICS;

export interface ReportRun {
  id: string;
  name: string;
  scene: string | null;
  source: string | null;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  commit: string | null;
}

interface ReportMachineProvenance {
  id?: string;
  cpu?: string;
}

interface ReportProvenance {
  machine?: ReportMachineProvenance;
  browser?: string;
  displayCapHz?: number;
}

interface ReportCanvas {
  width: number;
  height: number;
  dpr?: number;
}

export interface CutRow {
  name: string | number;
  triangles: number;
}

export interface CutAnalysis {
  total: number;
  unknown: number | string;
  byPrimitive: CutRow[];
  byLevel: CutRow[];
}

export interface TimingStat {
  p50: number;
  p95: number;
  mean?: number;
  p99?: number;
  max?: number;
}

interface StageTiming {
  stage: string;
  label?: string;
  cpuMs: TimingStat | null;
  gpuMs: TimingStat | null;
  counts?: Record<string, number>;
}

interface GpuPassTiming {
  name: string;
  bloc?: string;
  gpuMs: TimingStat | null;
}

interface ReportRecordData {
  gpuFrameMs?: TimingStat;
  cpuFrameMs?: TimingStat;
  imageTenue?: boolean;
  profilParEtape?: {
    gpuMethod?: string;
    gpuImageMs?: TimingStat;
    stages?: StageTiming[];
  };
  passesGpu?: { passes?: GpuPassTiming[] };
  cheminCalcul?: { clockCoarse?: boolean };
  cutAnalysis?: CutAnalysis;
}

export interface ReportRecord {
  id: string;
  runId: string;
  scene: string;
  sceneNote: string | null;
  view: string;
  quality: number;
  engine: string;
  commit: string | null;
  pathVersion: number | null;
  assetKey: string | null;
  buildHash: string | null;
  variant: string | null;
  provenance: ReportProvenance | null;
  pose: unknown;
  canvas: ReportCanvas | null;
  settings: Record<string, unknown>;
  errors: boolean;
  gpuMethod: string | null;
  witness: { pixels: number; total: number } | null;
  difference: { pixels: number; total: number } | null;
  differencePair: string | null;
  identicalCut: boolean | null;
  data: ReportRecordData;
  image: string | null;
}

export interface Report {
  formatVersion: typeof REPORT_VERSION;
  id: string;
  runs: ReportRun[];
  records: ReportRecord[];
}

export interface ReportSource {
  run: ReportRun;
  data: unknown;
}

export interface CampaignIndexItem {
  id: string;
  records?: number;
  date?: string;
}

/** Loading, failed or listed without a campaign; a loaded report always carries its sources. */
export type ReportsState =
  | {
      loading: boolean;
      error?: boolean;
      index?: CampaignIndexItem[];
      report?: undefined;
      sources?: undefined;
    }
  | {
      loading: false;
      error?: undefined;
      index: CampaignIndexItem[];
      report: Report;
      sources: ReportSource[];
    };

export interface SourceReadingRecord {
  id: string;
  runId: string;
  scene?: string;
  view?: string;
  quality?: number;
  engine?: string;
  side: string;
  canvas?: ReportCanvas | null;
  complete: {
    run: Record<string, unknown>;
    frame: Record<string, unknown>;
    measurement: Record<string, unknown>;
  };
}
