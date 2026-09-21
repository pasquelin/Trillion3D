import { offlineExamples } from './catalog.ts';
import type { Localized } from '../../content/locale.ts';
import type { RendererLessonItem } from '../rendererLessonTypes.ts';
const text = (en: string, fr: string): Localized => ({ en, fr });
export const offlineLessons: RendererLessonItem[] = offlineExamples.map((example) => ({
  ...example,
  renderer: true,
  warning: ['offline-painted', 'offline-height-palette', 'offline-uv-tiles'].includes(example.id)
    ? text(
        'The source contains vertex colours or UV coordinates; this preview only renders its uniform material. Attribute shading is not demonstrated.',
        'La source contient des couleurs par sommet ou des coordonnées UV ; cet aperçu affiche uniquement le matériau uniforme. Le rendu de ces attributs n’est pas démontré.',
      )
    : undefined,
  kind: 'offline',
  controls: [],
  manifest: example.asset,
  importedLights: true,
  try: text(
    'Orbit the authored surface, then inspect its construction source.',
    'Tournez autour de la surface, puis inspectez son code de construction.',
  ),
  changes: text(
    'Geometry is authored and compiled before loading; camera navigation remains interactive.',
    'La géométrie est préparée et compilée avant chargement ; la caméra reste interactive.',
  ),
}));
