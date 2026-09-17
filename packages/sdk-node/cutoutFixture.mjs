/**
 * Une entrée de feuille de réponses, partagée par les tests des découpes : la même forme que le
 * compilateur écrit, pour qu'un champ qui bouge d'un côté casse les deux d'un coup.
 */
export const leaf = (blendPrimitives) => ({
  image: 'feuillage.png',
  used: true,
  measure: { betweenPercent: 4.3, atContourPercent: 99.7, absentPercent: 85.8 },
  blendPrimitives,
  proposal: 'cutout',
  cutout: null,
});
