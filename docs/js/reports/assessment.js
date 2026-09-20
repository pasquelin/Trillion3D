import { metricValue } from './metrics.js';
/** Explicit reading thresholds, never relative engine rankings or inferred FPS. */
export function assessment(record, metric) {
  const value = metricValue(record, metric);
  if (value === null) return { tone: 'neutral', code: 'missing' };
  if (record.errors) return { tone: 'warning', code: 'incomplete' };
  if (['gpu', 'cpu', 'sync'].includes(metric)) {
    const budget = 1000 / 60;
    return value > budget
      ? { tone: 'error', code: 'over' }
      : value > budget * 0.8
        ? { tone: 'warning', code: 'near' }
        : { tone: 'success', code: 'within' };
  }
  if (metric === 'uncovered')
    return value > 0 ? { tone: 'error', code: 'holes' } : { tone: 'success', code: 'covered' };
  return { tone: 'neutral', code: 'noTarget' };
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

export function engineTone(engine) {
  return (
    {
      'three-nu': 'primary',
      'three-lod': 'secondary',
      'webgpu-page-raster': 'accent',
      'exact-cluster-pages': 'info',
    }[engine] ?? 'neutral'
  );
}
