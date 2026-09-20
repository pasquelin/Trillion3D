const replacements = [
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
];

export function localizeResult(result, locale) {
  if (!String(locale).toLowerCase().startsWith('fr')) return result;
  let value = result.value;
  for (const [english, french] of replacements) value = value.replaceAll(english, french);
  return { ...result, value };
}
