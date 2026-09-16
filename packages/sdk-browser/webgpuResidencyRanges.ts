/** Pages sautées qu'une même écriture couvre plutôt que d'en ouvrir une seconde. */
export const RESIDENCY_RANGE_GAP = 64;
/** Plages au plus par vidange : au-delà, tout est écrit d'un coup. Des milliers de petites écritures
 *  coûtent plus que la seule qu'elles remplacent. */
export const RESIDENCY_RANGE_MAX = 32;

/**
 * Regroupe des index de page croissants en plages contiguës, écrites dans `into` par couples
 * `[premier, dernier]`. Deux plages séparées par moins de `RESIDENCY_RANGE_GAP` pages n'en font
 * qu'une : les pages intermédiaires sont réécrites avec leur valeur actuelle, ce qui ne change rien
 * et évite une seconde écriture. Rend le nombre de plages, ou `1` couvrant tout quand il y en aurait
 * plus que `RESIDENCY_RANGE_MAX`.
 */
export function coalesceResidencyRanges(sorted: Int32Array, count: number, into: Int32Array) {
  if (count <= 0) return 0;
  let ranges = 0,
    from = sorted[0],
    to = sorted[0];
  for (let i = 1; i < count; i++) {
    const page = sorted[i];
    if (page - to <= RESIDENCY_RANGE_GAP) {
      to = page;
      continue;
    }
    if (ranges === RESIDENCY_RANGE_MAX) {
      into[0] = sorted[0];
      into[1] = sorted[count - 1];
      return 1;
    }
    into[ranges * 2] = from;
    into[ranges * 2 + 1] = to;
    ranges++;
    from = page;
    to = page;
  }
  if (ranges === RESIDENCY_RANGE_MAX) {
    into[0] = sorted[0];
    into[1] = sorted[count - 1];
    return 1;
  }
  into[ranges * 2] = from;
  into[ranges * 2 + 1] = to;
  return ranges + 1;
}
