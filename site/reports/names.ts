import { wordFor } from '../content/i18n/dictionary.ts';
import { wordsOf } from '../app/i18n.ts';
import type { Locale } from '../content/locale.ts';

/** A camera view's name in `locale`: `report.views.<id>`, or the id itself. */
export const viewName = (id: string, locale: Locale) =>
  wordFor(wordsOf(locale)('report.views', { returnObjects: true }), id) ?? id;

/** A run's name in `locale`: `report.runNames.<id>`, or one the run's id pattern composes from
 *  `report.runPatterns`, or the id itself. */
export function runName(id: string, locale: Locale) {
  const t = wordsOf(locale);
  const named = wordFor(t('report.runNames', { returnObjects: true }), id);
  if (named) return named;
  const withoutShadows = t('report.runPatterns.withoutShadows');
  const size = id?.match(/^(?:res|three-(?:nu|lod))-(\d+)(?:-e(\d+))?$/);
  if (size)
    return `${id.startsWith('three-lod') ? 'Three.js LOD / Web Geometry · ' : id.startsWith('three-nu') ? 'Three.js / Web Geometry · ' : ''}${t('report.runPatterns.imageWidth', { width: size[1] })}${size[2] ? ` · ${t('report.runPatterns.threshold', { threshold: size[2] })}` : ''}`;
  const lights = id?.match(/^(?:(three-nu|three-lod)-)?lampes-(\d+)(-sans-ombres)?$/);
  if (lights)
    return `${lights[1] ? `${engineName(lights[1])} / Web Geometry · ` : ''}${t('report.runPatterns.lights', { count: Number(lights[2]) })}${lights[3] ? ` ${withoutShadows}` : ''}`;
  const instances = id?.match(/^instances-(\d+)$/);
  if (instances) return t('report.runPatterns.sceneCopies', { count: Number(instances[1]) });
  const shadows = id?.match(/^(three-nu|three-lod)-sans-ombres$/);
  if (shadows) return `${engineName(shadows[1])} / Web Geometry · ${withoutShadows}`;
  return id;
}
const ENGINE_NAMES: Record<string, string> = {
  'webgpu-page-raster': 'Web Geometry · WebGPU',
  'exact-cluster-pages': 'SDK · reference',
  'three-nu': 'Three.js',
  'three-lod': 'Three.js LOD',
};
export const engineName = (id: string | undefined) =>
  id === undefined ? '—' : (ENGINE_NAMES[id] ?? id);
