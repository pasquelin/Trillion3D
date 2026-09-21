import { metricValue } from './metrics.ts';
import type { MetricKey } from './metrics.ts';
import type { ReportRecord } from './types.ts';

/** Explicit reading thresholds, never relative engine rankings or inferred FPS. */
export function assessment(record: ReportRecord, metric: MetricKey) {
  const value = metricValue(record, metric);
  if (value === null) return { tone: 'neutral', code: 'missing' } as const;
  if (record.errors) return { tone: 'warning', code: 'incomplete' } as const;
  if (['gpu', 'cpu', 'sync'].includes(metric)) {
    const budget = 1000 / 60;
    return value > budget
      ? ({ tone: 'error', code: 'over' } as const)
      : value > budget * 0.8
        ? ({ tone: 'warning', code: 'near' } as const)
        : ({ tone: 'success', code: 'within' } as const);
  }
  if (metric === 'uncovered')
    return value > 0
      ? ({ tone: 'error', code: 'holes' } as const)
      : ({ tone: 'success', code: 'covered' } as const);
  return { tone: 'neutral', code: 'noTarget' } as const;
}
export const ASSESSMENT_LABELS = {
  within: ['Within budget', 'Dans le budget'],
  near: ['Near the limit', 'Proche de la limite'],
  over: ['Over budget', 'Budget dépassé'],
  missing: ['Not measured', 'Non mesuré'],
  incomplete: ['Incomplete run', 'Exécution incomplète'],
  holes: ['Uncovered triangles', 'Triangles non couverts'],
  covered: ['No uncovered triangles', 'Aucun triangle non couvert'],
  noTarget: ['No target defined', 'Pas de seuil défini'],
};

type EngineTone = 'primary' | 'secondary' | 'accent' | 'info' | 'neutral';
const ENGINE_TONES: Record<string, EngineTone> = {
  'three-nu': 'primary',
  'three-lod': 'secondary',
  'webgpu-page-raster': 'accent',
  'exact-cluster-pages': 'info',
};
export function engineTone(engine: string) {
  return ENGINE_TONES[engine] ?? 'neutral';
}
