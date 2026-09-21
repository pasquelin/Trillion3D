import type { Locale } from '../types/portal.ts';

const english: Record<string, string> = {
  tx: 'translation x',
  angle: 'rotation',
  scale: 'scale',
  parent: 'parent angle',
  child: 'child offset',
  fov: 'field of view',
  depth: 'depth',
  x: 'x',
  angleA: 'arrow a',
  angleB: 'arrow b',
  y: 'y',
  points: 'points',
  width: 'width',
  height: 'height',
  childX: 'child offset',
  left: 'left grey',
  right: 'right grey',
  base: 'base error',
  frame: 'frame time',
  budget: 'budget',
  scaleY: 'vertical scale',
};

const french: Record<string, string> = {
  tx: 'translation x',
  angle: 'rotation',
  scale: 'échelle',
  parent: 'angle parent',
  child: 'décalage enfant',
  fov: 'champ de vision',
  depth: 'profondeur',
  x: 'x',
  angleA: 'flèche a',
  angleB: 'flèche b',
  y: 'y',
  points: 'points',
  width: 'largeur',
  height: 'hauteur',
  childX: 'décalage enfant',
  left: 'gris gauche',
  right: 'gris droit',
  base: 'erreur de base',
  frame: 'temps de trame',
  budget: 'budget',
  scaleY: 'échelle verticale',
};

export const controlLabel = (name: string, locale: Locale): string | undefined =>
  (locale === 'fr' ? french : english)[name];
