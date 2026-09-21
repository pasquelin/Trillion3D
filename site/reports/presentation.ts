import type { Locale } from '../content/locale.ts';
import { engineName, runName, viewName } from './names.ts';
import type { Report, ReportRecord, SourceReadingRecord } from './types.ts';

/** What a reading's label reads: a report record carries it all, a source reading part of it. */
type Reading = Pick<SourceReadingRecord, 'runId' | 'engine' | 'view' | 'quality' | 'canvas'>;

export const sceneName = (id: string | null | undefined) =>
  (id ?? '—').replaceAll('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const runOf = (report: Report, record: Reading) =>
  report.runs.find((r) => r.id === record.runId)?.name ?? '';
export function readingName(record: Reading | null | undefined, locale: Locale) {
  if (!record) return '—';
  return `${engineName(record.engine)} · ${viewName(record.view ?? '—', locale)} · ${record.quality ?? '—'} px`;
}
export function recordLabel(report: Report, record: Reading, locale: Locale) {
  const size = record.canvas ? `${record.canvas.width} × ${record.canvas.height}` : '—';
  return `${runName(runOf(report, record), locale)} · ${readingName(record, locale)} · ${size}`;
}
/** The two members of an A/B image pair, same shape as the records they came from. */
export function pairedImages<T extends ReportRecord>(records: T[]): [T, T][] {
  const groups = new Map<string, T[]>();
  for (const r of records) {
    if (!r.image || !r.differencePair) continue;
    const group = groups.get(r.differencePair) ?? [];
    group.push(r);
    groups.set(r.differencePair, group);
  }
  return [...groups.values()]
    .filter((rows) => rows.length === 2)
    .map(
      (rows) =>
        // filtered above to exactly two entries; `toSorted` returns T[], so this closes the tuple
        rows.toSorted(
          (a, b) =>
            Number(a.engine === 'webgpu-page-raster') - Number(b.engine === 'webgpu-page-raster'),
        ) as [T, T],
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
