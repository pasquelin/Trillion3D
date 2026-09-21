import type { Locale } from '../locale.ts';

export const sectionStrings: Record<Locale, Record<string, string>> = {
  en: {
    'section.guides': 'Guides',
    'section.examples': 'Examples',
    'section.demo': 'Live demo',
    'section.enums': 'Constants & types',
    'section.lifecycle': 'Engine lifecycle',
    'section.camera': 'Camera & projection',
    'section.host': 'Host camera & sides',
    'section.matrices': 'Matrices',
    'section.vectors': 'Vectors',
    'section.colors': 'Colours',
    'section.bounds': 'Bounds & visibility',
    'section.tree': 'Transform tree',
    'section.batches': 'Batch math',
  },
  fr: {
    'section.guides': 'Guides',
    'section.examples': 'Exemples',
    'section.demo': 'Démo interactive',
    'section.enums': 'Constantes et types',
    'section.lifecycle': 'Cycle de vie du moteur',
    'section.camera': 'Caméra et projection',
    'section.host': 'Caméra hôte et faces',
    'section.matrices': 'Matrices',
    'section.vectors': 'Vecteurs',
    'section.colors': 'Couleurs',
    'section.bounds': 'Volumes et visibilité',
    'section.tree': 'Arbre de transformations',
    'section.batches': 'Calcul par lots',
  },
};
