import { metricValue } from './metrics.ts';
import type { MetricKey } from './metrics.ts';
import type { ReportRecord } from './types.ts';

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** A declared experimental variable may differ; every other condition must match. */
export function comparison(
  a: ReportRecord | null | undefined,
  b: ReportRecord | null | undefined,
  metric: MetricKey,
  variable = 'engine',
) {
  if (!a || !b || a.id === b.id) return { status: 'choose', delta: null, percent: null } as const;
  const reasons: string[] = [];
  if (!['engine', 'version', 'lightShadows', 'temporalAntialiasing', 'mathPath'].includes(variable))
    reasons.push('settings');
  if (
    !a.provenance?.machine?.id ||
    !b.provenance?.machine?.id ||
    !a.provenance.browser ||
    !b.provenance.browser
  )
    reasons.push('provenance');
  else if (
    !equal(a.provenance.machine, b.provenance.machine) ||
    a.provenance.browser !== b.provenance.browser
  )
    reasons.push('machine');
  const conditions = [
    'scene',
    'view',
    'quality',
    'pose',
    'canvas',
    'pathVersion',
    'assetKey',
  ] as const;
  for (const key of conditions) {
    if (a[key] == null || b[key] == null || !equal(a[key], b[key])) reasons.push(key);
  }
  if (!a.data.erreur || a.data.erreur !== b.data.erreur) reasons.push('errorMetric');
  if (!a.buildHash || !b.buildHash || (variable !== 'version' && a.buildHash !== b.buildHash))
    reasons.push('version');
  if (!equal(a.variant, b.variant)) reasons.push('settings');
  if (!a.canvas?.dpr || !b.canvas?.dpr) reasons.push('canvas');
  if (variable !== 'engine' && a.engine !== b.engine) reasons.push('engine');
  const settings = (record: ReportRecord) =>
    Object.fromEntries(
      Object.entries(record.settings).filter(
        ([key]) => !['port', 'engine', 'pixelErrors', variable].includes(key),
      ),
    );
  if (!equal(settings(a), settings(b))) reasons.push('settings');
  if (metric === 'gpu' && (!a.gpuMethod || a.gpuMethod !== b.gpuMethod)) reasons.push('method');
  if (a.errors || b.errors) reasons.push('errors');
  const left = metricValue(a, metric),
    right = metricValue(b, metric);
  if (left === null || right === null) reasons.push('unmeasured');
  if (reasons.length || left === null || right === null)
    return {
      status: 'incompatible',
      reasons: [...new Set(reasons)],
      delta: null,
      percent: null,
    } as const;
  return {
    status: 'descriptive',
    reasons: [],
    delta: right - left,
    percent: left === 0 ? null : ((right - left) / left) * 100,
  } as const;
}
