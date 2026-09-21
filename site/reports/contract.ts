import type { Report } from './types.ts';

/** Shared browser/export validation. Unknown versions fail rather than silently changing meaning. */
export const REPORT_VERSION = 1;
export const RUN_STATUSES = ['complete', 'failed', 'missing'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Where raw JSON is inspected, a type predicate narrows it: no interface carries an index signature. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRunStatus(value: unknown): value is RunStatus {
  const statuses: readonly string[] = RUN_STATUSES;
  return typeof value === 'string' && statuses.includes(value);
}

export function assetPath(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(value) &&
    !value.split('/').some((part) => part === '..' || part === '.' || !part)
  );
}

/** Dynamic dotted paths (the metric and diagnostic tables) traverse `unknown` rather than widening
 * the record data into a de facto index signature. */
export function readPath(data: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((value, part) => (isObject(value) ? value[part] : undefined), data);
}

/** Throws on the first check a report fails; the checks are the contract, not the interface. */
function checkReport(report: unknown): asserts report is Report {
  if (!isObject(report) || report.formatVersion !== REPORT_VERSION)
    throw new Error('Unsupported report format');
  if (
    typeof report.id !== 'string' ||
    !/^[a-z0-9-]+$/.test(report.id) ||
    !Array.isArray(report.runs) ||
    !Array.isArray(report.records)
  )
    throw new Error('Invalid report structure');
  const reportRuns: unknown[] = report.runs;
  const reportRecords: unknown[] = report.records;
  const ids = new Set<string>();
  for (const run of reportRuns) {
    if (
      !isObject(run) ||
      typeof run.id !== 'string' ||
      !run.id ||
      ids.has(run.id) ||
      !isRunStatus(run.status)
    )
      throw new Error('Invalid report run');
    ids.add(run.id);
    if (run.status !== 'missing' && run.source === null)
      throw new Error('Missing measurement source');
    if (run.source !== null && !assetPath(run.source)) throw new Error('Invalid source path');
  }
  const records = new Set<string>();
  for (const record of reportRecords) {
    if (
      !isObject(record) ||
      typeof record.id !== 'string' ||
      !record.id ||
      records.has(record.id) ||
      typeof record.runId !== 'string' ||
      !ids.has(record.runId) ||
      typeof record.scene !== 'string' ||
      typeof record.view !== 'string' ||
      !Number.isFinite(record.quality) ||
      !isObject(record.data) ||
      !isObject(record.settings)
    )
      throw new Error('Invalid report record');
    records.add(record.id);
    if (record.image !== null && !assetPath(record.image)) throw new Error('Invalid image path');
  }
}

export function assertReport(report: unknown) {
  checkReport(report);
  return report;
}
