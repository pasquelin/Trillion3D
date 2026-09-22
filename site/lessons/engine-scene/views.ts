import type { Locale } from '../../content/locale.ts';
import type { DiagnosticMode } from './diagnosticModes.ts';

/** What each diagnostic view of the garden shows, what to try and what to observe. */
export const sceneViews: Record<Locale, Record<DiagnosticMode, [string, string, string]>> = {
  en: {
    beauty: [
      'The finished lit image.',
      'Change light intensity and shadows.',
      'Materials respond while geometry stays identical.',
    ],
    clusters: [
      'One stable colour per selected cluster.',
      'Orbit and move closer to a ring.',
      'The cut replaces coarse clusters with finer ones.',
    ],
    wireframe: [
      'One filled colour per submitted triangle.',
      'Zoom into a curved silhouette.',
      'Triangles become finer where the source carries detail.',
    ],
    triangles: [
      'One filled colour per submitted triangle.',
      'Zoom into a curved silhouette.',
      'Triangles become finer where the source carries detail.',
    ],
  },
  fr: {
    beauty: [
      'L’image finale éclairée.',
      'Changez l’intensité et les ombres.',
      'Les matériaux réagissent sans changer la géométrie.',
    ],
    clusters: [
      'Une couleur stable par grappe sélectionnée.',
      'Tournez puis approchez-vous d’un anneau.',
      'La coupe remplace les grappes grossières par des grappes plus fines.',
    ],
    wireframe: [
      'Une couleur pleine par triangle soumis.',
      'Zoomez sur une silhouette courbe.',
      'Les triangles se resserrent là où la source porte du détail.',
    ],
    triangles: [
      'Une couleur pleine par triangle soumis.',
      'Zoomez sur une silhouette courbe.',
      'Les triangles se resserrent là où la source porte du détail.',
    ],
  },
};
