import { engineName, runName, viewName } from './names.js';
export const sceneName = (id) =>
  (id ?? '—').replaceAll('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const runOf = (report, record) => report.runs.find((r) => r.id === record.runId)?.name ?? '';
export function readingName(record, locale) {
  if (!record) return '—';
  return `${engineName(record.engine)} · ${viewName(record.view ?? '—', locale)} · ${record.quality ?? '—'} px`;
}
export function recordLabel(report, record, locale) {
  const size = record.canvas ? `${record.canvas.width} × ${record.canvas.height}` : '—';
  return `${runName(runOf(report, record), locale)} · ${readingName(record, locale)} · ${size}`;
}
/**
 * @template T
 * @param {T[]} records
 * @returns {[T, T][]}
 */
export function pairedImages(records) {
  const groups = new Map();
  for (const r of records) {
    if (!r.image || !r.differencePair) continue;
    const group = groups.get(r.differencePair) ?? [];
    group.push(r);
    groups.set(r.differencePair, group);
  }
  return [...groups.values()]
    .filter((rows) => rows.length === 2)
    .map((rows) =>
      rows.toSorted(
        (a, b) =>
          Number(a.engine === 'webgpu-page-raster') - Number(b.engine === 'webgpu-page-raster'),
      ),
    );
}
export const REPORT_SECTIONS = [
  ['overview', 'Summary', 'Bilan'],
  ['compare', 'Comparisons', 'Comparaisons'],
  ['evidence', 'Renders', 'Rendus'],
  ['experiments', 'Resolution and options', 'Résolution et options'],
  ['detail', 'CPU / GPU', 'CPU / GPU'],
  ['all-values', 'Complete figures', 'Chiffres complets'],
  ['references', 'References', 'Références'],
];
