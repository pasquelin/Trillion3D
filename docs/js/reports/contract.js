/** Shared browser/export validation. Unknown versions fail rather than silently changing meaning. */
export const REPORT_VERSION = 1;
export function assetPath(value) {
  return (
    typeof value === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(value) &&
    !value.split('/').some((part) => part === '..' || part === '.' || !part)
  );
}
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export function assertReport(report) {
  if (report?.formatVersion !== REPORT_VERSION) throw new Error('Unsupported report format');
  if (
    !/^[a-z0-9-]+$/.test(report.id ?? '') ||
    !Array.isArray(report.runs) ||
    !Array.isArray(report.records)
  )
    throw new Error('Invalid report structure');
  const ids = new Set();
  for (const run of report.runs) {
    if (!run.id || ids.has(run.id) || !['complete', 'failed', 'missing'].includes(run.status))
      throw new Error('Invalid report run');
    ids.add(run.id);
    if (run.status !== 'missing' && run.source === null)
      throw new Error('Missing measurement source');
    if (run.source !== null && !assetPath(run.source)) throw new Error('Invalid source path');
  }
  const records = new Set();
  for (const record of report.records) {
    if (
      !record.id ||
      records.has(record.id) ||
      !ids.has(record.runId) ||
      typeof record.scene !== 'string' ||
      typeof record.view !== 'string' ||
      !Number.isFinite(record.quality) ||
      !object(record.data) ||
      !object(record.settings)
    )
      throw new Error('Invalid report record');
    records.add(record.id);
    if (record.image !== null && !assetPath(record.image)) throw new Error('Invalid image path');
  }
  return report;
}
