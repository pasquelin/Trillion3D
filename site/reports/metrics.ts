import type { Locale } from '../content/locale.ts';
import { isObject, readPath } from './contract.ts';
import type { ReportRecord, TimingStat } from './types.ts';

export interface MetricDefinition {
  unit: string;
  path: string;
  stat?: boolean;
  divisor?: number;
}

/** Stable metric IDs, units and source paths; no presentation text in campaign data. */
export const METRICS = {
  gpu: { unit: 'ms', path: 'gpuFrameMs', stat: true },
  cpu: { unit: 'ms', path: 'cpuFrameMs', stat: true },
  cadence: { unit: 'ms', path: 'rafIntervalMs', stat: true },
  sync: { unit: 'ms', path: 'imageSyncMs', stat: true },
  triangles: { unit: '', path: 'drawnTriangles' },
  selected: { unit: '', path: 'selectedTriangles' },
  uncovered: { unit: '', path: 'uncoveredTriangles' },
  geometry: { unit: 'MiB', path: 'geometrieOctets', divisor: 1048576 },
  textures: { unit: 'MiB', path: 'metrics.textureResidentBytes', divisor: 1048576 },
  textureBudget: { unit: 'MiB', path: 'metrics.textureBudgetBytes', divisor: 1048576 },
  pool: { unit: 'MiB', path: 'metrics.texturePoolBytes', divisor: 1048576 },
  calls: { unit: '', path: 'metrics.drawCalls' },
  preparation: { unit: 'ms', path: 'preparationMs' },
} satisfies Record<string, MetricDefinition>;
export type MetricKey = keyof typeof METRICS;

export function metricValue(
  record: ReportRecord | null | undefined,
  key: MetricKey,
  percentile: keyof TimingStat = 'p50',
): number | null {
  const metric: MetricDefinition = METRICS[key];
  const source: unknown =
    key === 'gpu'
      ? (record?.data?.profilParEtape?.gpuImageMs ?? record?.data?.gpuFrameMs)
      : readPath(record?.data, metric.path);
  const value: unknown = metric.stat && isObject(source) ? source[percentile] : source;
  return typeof value === 'number' && Number.isFinite(value) ? value / (metric.divisor ?? 1) : null;
}
export function formatValue(value: number | null | undefined, locale: Locale, unit = ''): string {
  if (value === null || value === undefined) return '—';
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit ? 2 : 0 }).format(value)}${unit ? ` ${unit}` : ''}`;
}
