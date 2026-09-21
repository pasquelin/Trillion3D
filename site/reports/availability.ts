import type { Locale } from '../content/locale.ts';
import type { MetricKey } from './metrics.ts';
import type { ReportRecord } from './types.ts';

export function missingMetric(
  record: ReportRecord | null | undefined,
  metric: MetricKey,
  locale: Locale,
) {
  const fr = locale === 'fr';
  if (!record) return fr ? 'Mesure absente' : 'Missing reading';
  const three = record.engine?.startsWith('three-');
  if (three && ['selected', 'uncovered'].includes(metric))
    return fr
      ? 'Sans objet : ce moteur ne sélectionne pas de grappes'
      : 'Not applicable: this renderer does not select clusters';
  if (metric === 'gpu' && record.data.imageSyncMs)
    return fr
      ? 'Temps GPU isolé non mesuré ; voir rendu + attente'
      : 'Isolated GPU time not measured; see render + wait';
  if (metric === 'sync' && record.gpuMethod)
    return fr
      ? 'Rendu + attente non mesuré ; voir enveloppe GPU'
      : 'Render + wait not measured; see GPU envelope';
  if (metric === 'cadence')
    return fr ? 'Intervalle d’affichage non enregistré' : 'Display interval not recorded';
  return fr ? 'Non enregistré dans cette mesure' : 'Not recorded in this reading';
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
