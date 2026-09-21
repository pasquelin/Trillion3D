import type { Locale } from '../content/locale.ts';

const replacements: [string, string][] = [
  ['corner', 'sommet'],
  ['world position', 'position monde'],
  ['projected', 'projeté'],
  ['outside', 'dehors'],
  ['crossing', 'intersecté'],
  ['inside', 'dedans'],
  ['same direction', 'même direction'],
  ['opposed', 'opposés'],
  ['perpendicular', 'perpendiculaires'],
  ['counter-clockwise', 'antihoraire'],
  ['clockwise', 'horaire'],
  ['length', 'longueur'],
  ['sphere radius', 'rayon de la sphère'],
  ['child world', 'enfant dans le monde'],
  ['midpoints', 'moyennes'],
  ['screen', 'écran'],
  ['light', 'lumière'],
  ['allowed error', 'erreur admise'],
  ['recovered', 'retrouvé'],
  ['mirrored', 'inversée'],
  ['preserved', 'préservée'],
  ['collapsed', 'aplatie'],
  ['corrected normal', 'normale corrigée'],
];

export function localizeResult<T extends { value: string }>(result: T, locale: Locale): T {
  if (!String(locale).toLowerCase().startsWith('fr')) return result;
  let value = result.value;
  for (const [english, french] of replacements) value = value.replaceAll(english, french);
  return { ...result, value };
}
