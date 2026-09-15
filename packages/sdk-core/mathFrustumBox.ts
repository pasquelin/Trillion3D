/**
 * Une boîte alignée sur les axes contre les six plans d'un tronc (voir `mathFrustum.ts`).
 *
 * Pour chaque plan, le signe de sa normale choisit le coin le plus avancé de la boîte, et le plan
 * rejette quand ce coin est derrière lui : `a·x + b·y + c·z + d < 0`. C'est le test de boîte du
 * tronc de Three.js, mêmes produits et même somme ; une comparaison avec NaN ne rejette jamais.
 * Le résultat ne dépend pas de l'ordre des plans, seulement le plan qui conclut.
 */

/** Les six coordonnées de la boîte, rangées pour que le signe du plan serve d'indice. */
const bounds = new Float64Array(6);

function loadBounds(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  bounds[0] = minX;
  bounds[1] = maxX;
  bounds[2] = minY;
  bounds[3] = maxY;
  bounds[4] = minZ;
  bounds[5] = maxZ;
}

/** Un plan a déjà son coin le plus avancé derrière lui. */
function excludesLoaded(planes: Float64Array) {
  for (let p = 0; p < 24; p += 4) {
    const a = planes[p],
      b = planes[p + 1],
      c = planes[p + 2],
      d = planes[p + 3];
    if (a * bounds[a > 0 ? 1 : 0] + b * bounds[b > 0 ? 3 : 2] + c * bounds[c > 0 ? 5 : 4] + d < 0)
      return true;
  }
  return false;
}

/** Vraie quand la boîte est entièrement hors du tronc : un plan laisse tous ses coins derrière. */
export function frustumExcludesBox(
  planes: Float64Array,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  loadBounds(minX, minY, minZ, maxX, maxY, maxZ);
  return excludesLoaded(planes);
}

/**
 * La boîte contre le tronc en trois états : 0 dehors, 1 à cheval, 2 entièrement dedans. Un
 * sous-arbre entièrement dedans épargne un test à chaque boîte sous lui.
 *
 * Deux passes : la première ne fait que rejeter ; la seconde, sur le coin le plus reculé, ne sert
 * qu'à distinguer « à cheval » de « dedans » et s'arrête au premier plan traversé.
 */
export function frustumClipBox(
  planes: Float64Array,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  loadBounds(minX, minY, minZ, maxX, maxY, maxZ);
  if (excludesLoaded(planes)) return 0;
  for (let p = 0; p < 24; p += 4) {
    const a = planes[p],
      b = planes[p + 1],
      c = planes[p + 2],
      d = planes[p + 3];
    if (a * bounds[a > 0 ? 0 : 1] + b * bounds[b > 0 ? 2 : 3] + c * bounds[c > 0 ? 4 : 5] + d < 0)
      return 1;
  }
  return 2;
}
