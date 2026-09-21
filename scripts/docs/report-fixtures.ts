import { REPORT_VERSION } from '../../site/reports/contract.ts';
import type { Report, ReportRecord } from '../../site/reports/types.ts';

type ReportRun = Report['runs'][number];

/** A minimal but complete run, for tests that only care about a couple of its fields. */
export const baseRun: ReportRun = {
  id: 'run',
  name: 'run',
  scene: null,
  source: null,
  status: 'complete',
  startedAt: null,
  finishedAt: null,
  commit: null,
};

/** A minimal but complete record, satisfying `ReportRecord`'s full shape so tests can spread
 * it and override only the handful of fields the component under test actually reads. */
export const baseRecord: ReportRecord = {
  id: 'record',
  runId: 'run',
  scene: 'scene',
  sceneNote: null,
  view: 'view',
  quality: 1,
  engine: 'engine',
  commit: null,
  pathVersion: null,
  assetKey: null,
  buildHash: null,
  variant: null,
  provenance: null,
  pose: null,
  canvas: null,
  settings: {},
  errors: false,
  gpuMethod: null,
  witness: null,
  difference: null,
  differencePair: null,
  identicalCut: null,
  data: {},
  image: null,
};

export const baseReport: Report = {
  formatVersion: REPORT_VERSION,
  id: 'report',
  runs: [],
  records: [],
};
