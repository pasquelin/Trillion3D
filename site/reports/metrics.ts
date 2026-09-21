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
};
export function metricValue(record, key, percentile = 'p50') {
  const metric = METRICS[key];
  const source =
    key === 'gpu'
      ? (record?.data?.profilParEtape?.gpuImageMs ?? record?.data?.gpuFrameMs)
      : metric.path.split('.').reduce((value, part) => value?.[part], record?.data);
  const value = metric.stat ? source?.[percentile] : source;
  return typeof value === 'number' && Number.isFinite(value) ? value / (metric.divisor ?? 1) : null;
}
export function formatValue(value, locale, unit = '') {
  if (value === null || value === undefined) return '—';
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit ? 2 : 0 }).format(value)}${unit ? ` ${unit}` : ''}`;
}
