import { wordsOf } from '../app/i18n.ts';
import type { Locale } from '../content/locale.ts';
import type { MetricKey } from './metrics.ts';
import type { ReportRecord } from './types.ts';

/** Why `record` has no `metric`, in `locale`'s words. */
export function missingMetric(
  record: ReportRecord | null | undefined,
  metric: MetricKey,
  locale: Locale,
) {
  const t = wordsOf(locale);
  if (!record) return t('report.missingWhy.noReading');
  if (record.engine?.startsWith('three-') && ['selected', 'uncovered'].includes(metric))
    return t('report.missingWhy.noClusters');
  if (metric === 'gpu' && record.data.imageSyncMs) return t('report.missingWhy.gpuIsolated');
  if (metric === 'sync' && record.gpuMethod) return t('report.missingWhy.syncMissing');
  if (metric === 'cadence') return t('report.missingWhy.cadence');
  return t('report.missingWhy.notRecorded');
}
function isTraversable(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/** Preserve every leaf, including null and zero, for the complete comparison tables. */
export function flattenFields(value: unknown, path = '', result: Map<string, unknown> = new Map()) {
  if (isTraversable(value)) {
    const entries = Object.entries(value);
    if (!entries.length) result.set(path, Array.isArray(value) ? '[]' : '{}');
    for (const [key, item] of entries) flattenFields(item, path ? `${path}.${key}` : key, result);
  } else result.set(path, value);
  return result;
}
