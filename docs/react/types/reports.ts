import type { ReactNode } from 'react';
import type { Locale } from './portal.ts';

export type RunStatus = 'complete' | 'failed' | 'missing';

interface ReportRun {
  id: string;
  name: string;
  scene?: string | null;
  source?: string | null;
  status: RunStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  commit?: string | null;
}

interface ReportMachineProvenance {
  id?: string;
  cpu?: string;
  [key: string]: unknown;
}

interface ReportProvenance {
  machine?: ReportMachineProvenance;
  browser?: string;
  displayCapHz?: number;
  [key: string]: unknown;
}

interface ReportCanvas {
  width?: number;
  height?: number;
  dpr?: number;
  [key: string]: unknown;
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
  p50?: number;
  p95?: number;
  [key: string]: unknown;
}

interface StageTiming {
  stage: string;
  cpuMs?: TimingStat;
  counts?: Record<string, number>;
  [key: string]: unknown;
}

interface GpuPassTiming {
  name: string;
  gpuMs?: TimingStat;
  [key: string]: unknown;
}

interface ReportRecordData {
  gpuFrameMs?: number | TimingStat;
  cpuFrameMs?: TimingStat;
  imageTenue?: boolean;
  profilParEtape?: {
    gpuMethod?: string;
    gpuImageMs?: TimingStat;
    stages?: StageTiming[];
    [key: string]: unknown;
  };
  passesGpu?: { passes?: GpuPassTiming[]; [key: string]: unknown };
  cheminCalcul?: { clockCoarse?: boolean; [key: string]: unknown };
  cutAnalysis?: CutAnalysis;
  [key: string]: unknown;
}

export interface ReportRecord {
  id: string;
  runId: string;
  scene: string;
  sceneNote?: string | null;
  view: string;
  quality: number;
  engine: string;
  commit?: string | null;
  pathVersion?: string | number | null;
  assetKey?: string | null;
  buildHash?: string | null;
  variant?: string | Record<string, unknown> | null;
  provenance?: ReportProvenance | null;
  pose?: unknown;
  canvas?: ReportCanvas | null;
  settings?: Record<string, unknown>;
  errors?: boolean;
  gpuMethod?: string | null;
  witness?: { pixels?: number; total?: number; [key: string]: unknown } | null;
  difference?: { pixels?: number; [key: string]: unknown } | null;
  differencePair?: string | null;
  identicalCut?: unknown;
  data: ReportRecordData;
  image?: string | null;
  [key: string]: unknown;
}

export interface Report {
  formatVersion: number;
  id: string;
  runs: ReportRun[];
  records: ReportRecord[];
  [key: string]: unknown;
}

export interface ReportSource {
  run: Record<string, unknown>;
  data: unknown;
}

export interface CampaignIndexItem {
  id: string;
  title?: string;
  date?: string;
  [key: string]: unknown;
}

export interface ReportsState {
  loading: boolean;
  error?: boolean;
  index?: CampaignIndexItem[];
  report?: Report;
  sources?: ReportSource[];
}

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

export interface ProfilesProps {
  report: Report;
  locale: Locale;
}

export interface SceneProfilesProps {
  records: ReportRecord[];
  report: Report;
  locale: Locale;
}

export interface ProfileReadingProps {
  record: ReportRecord;
  report: Report;
  locale: Locale;
  filters?: ReactNode;
}
