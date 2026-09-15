import type { PageRec } from './pageSelectionTypes.ts';

/**
 * Le sens de parcours d'un cluster : vrai quand la matrice monde renverse l'orientation, ce qui
 * échange la face à éliminer. C'est un déterminant 3×3, et il ne change que lorsque la matrice
 * change — jamais entre deux images d'une scène immobile. Il était pourtant recalculé pour chaque
 * page et chaque image, jusqu'à quatre fois par page selon les chemins de dessin.
 *
 * L'époque est celle de la table de lignes, que le moteur incrémente déjà dès qu'une matrice monde
 * peut avoir bougé : `renderWebgpuPages` la pose en tête d'image, et un cluster dont l'époque
 * correspond rend la valeur déjà calculée. Une époque de trop ne fait que recalculer.
 */
let epoque = 0;

/** Pose l'époque de l'image. Au-delà, tout sens de parcours mémorisé est repris à zéro. */
export function setWindingEpoch(valeur: number) {
  epoque = valeur;
}

export function windingCw(rec: PageRec) {
  if (rec.windingEpoch === epoque && rec.windingCw !== undefined) return rec.windingCw;
  const e = rec.matrix.elements;
  const cw =
    e[0] * (e[5] * e[10] - e[6] * e[9]) -
      e[1] * (e[4] * e[10] - e[6] * e[8]) +
      e[2] * (e[4] * e[9] - e[5] * e[8]) <
    0;
  rec.windingEpoch = epoque;
  rec.windingCw = cw;
  return cw;
}
