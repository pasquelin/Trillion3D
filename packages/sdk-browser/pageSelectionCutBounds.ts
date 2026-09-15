import type { PageRecord } from './pageSelectionCutState.ts';

/**
 * Bornes par nœud de la hiérarchie de culling, dérivées une fois des clusters qu'elle range.
 *
 * Le manifeste porte déjà, par nœud, la boîte, une sphère englobante et l'erreur de remplacement
 * maximale du sous-arbre : de quoi rejeter un sous-arbre dont aucun cluster n'a de remplaçant
 * encore trop grossier, et rien de plus. Décider un sous-arbre autrement demande trois bornes que
 * le manifeste ne porte pas : le plancher et le plafond de l'erreur propre, le plancher de l'erreur
 * du remplaçant, chacun avec la sphère qui englobe celles qu'il résume. Toutes se lisent dans les
 * pages : la réduction est faite ici, à la préparation, une fois par primitive, sans toucher au
 * format du manifeste.
 *
 * Monotonie, l'invariant du lot : les bornes d'un nœud encadrent celles de tous ses descendants.
 * Un plafond sous le seuil vaut donc pour chaque cluster du sous-arbre, un plancher au-dessus du
 * seuil aussi, et la décision prise au nœud est mot pour mot celle qu'aurait rendue la descente.
 */
export const BOUND_STRIDE = 11;
export const OWN_FLOOR = 0,
  OWN_CEIL = 1,
  PARENT_FLOOR = 2,
  OWN_SPHERE = 3,
  PARENT_SPHERE = 7;

/** Étend la sphère englobante rangée en `at` pour couvrir celle lue en `from`.
 *  Rayon négatif : accumulateur encore vide. */
/** Miroir TypeScript de la fusion incrémentale de sphères de `dag/bounds.rs` (compilateur Rust) :
 *  même récurrence, deux langages, rien à partager entre les deux dépôts de code. */
function growSphere(into: Float64Array, at: number, sphere: ArrayLike<number>, from: number) {
  const radius = sphere[from + 3];
  if (!(radius >= 0)) return;
  const cx = sphere[from],
    cy = sphere[from + 1],
    cz = sphere[from + 2];
  const held = into[at + 3];
  if (!(held >= 0)) {
    into[at] = cx;
    into[at + 1] = cy;
    into[at + 2] = cz;
    into[at + 3] = radius;
    return;
  }
  const dx = cx - into[at],
    dy = cy - into[at + 1],
    dz = cz - into[at + 2];
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance + radius <= held) return;
  if (distance + held <= radius) {
    into[at] = cx;
    into[at + 1] = cy;
    into[at + 2] = cz;
    into[at + 3] = radius;
    return;
  }
  const next = (distance + held + radius) * 0.5,
    ratio = (next - held) / distance;
  into[at] += dx * ratio;
  into[at + 1] += dy * ratio;
  into[at + 2] += dz * ratio;
  into[at + 3] = next;
}

/** Réduit un cluster dans les bornes de son nœud feuille. */
function foldPage<T extends PageRecord>(values: Float64Array, at: number, rec: T) {
  const own = rec.lodError,
    sphere = rec.sphere;
  if (own === undefined || own === null) {
    // Cluster sans bande d'erreur : le nœud ne certifie plus rien, ni acceptation ni rejet.
    values[at + OWN_FLOOR] = 0;
    values[at + OWN_CEIL] = Infinity;
  } else {
    if (own < values[at + OWN_FLOOR]) values[at + OWN_FLOOR] = own;
    // Une erreur finie sans sphère se projette à l'infini : le plafond doit le dire.
    if (own > 0 && !sphere) values[at + OWN_CEIL] = Infinity;
    else if (own > values[at + OWN_CEIL]) values[at + OWN_CEIL] = own;
  }
  if (sphere) growSphere(values, at + OWN_SPHERE, sphere, 0);
  // Un cluster que rien ne remplace se projette à l'infini : il ne baisse aucun plancher.
  const parent = rec.parentError;
  if (parent === undefined || parent === null) return;
  if (parent < values[at + PARENT_FLOOR]) values[at + PARENT_FLOOR] = parent;
  const band = rec.parentSphere ?? sphere;
  if (band) growSphere(values, at + PARENT_SPHERE, band, 0);
}

/** Réduit un nœud enfant dans les bornes de son parent. */
function foldChild(values: Float64Array, at: number, from: number) {
  if (values[from + OWN_FLOOR] < values[at + OWN_FLOOR])
    values[at + OWN_FLOOR] = values[from + OWN_FLOOR];
  if (values[from + OWN_CEIL] > values[at + OWN_CEIL])
    values[at + OWN_CEIL] = values[from + OWN_CEIL];
  if (values[from + PARENT_FLOOR] < values[at + PARENT_FLOOR])
    values[at + PARENT_FLOOR] = values[from + PARENT_FLOOR];
  growSphere(values, at + OWN_SPHERE, values, from + OWN_SPHERE);
  growSphere(values, at + PARENT_SPHERE, values, from + PARENT_SPHERE);
}

/**
 * Bornes de chaque nœud, `BOUND_STRIDE` nombres par nœud, calculées une fois par primitive. Les
 * enfants d'un nœud sont toujours rangés après lui dans le tableau plat : un seul balayage
 * descendant suffit à remonter les bornes.
 */
export function cullingBounds<T extends PageRecord>(
  { nodes, stride }: { nodes: Float64Array; stride: number },
  pages: readonly T[],
) {
  const count = (nodes.length / stride) | 0;
  const values = new Float64Array(count * BOUND_STRIDE);
  for (let node = count - 1; node >= 0; node--) {
    const base = node * stride,
      at = node * BOUND_STRIDE;
    values[at + OWN_FLOOR] = Infinity;
    values[at + OWN_CEIL] = 0;
    values[at + PARENT_FLOOR] = Infinity;
    values[at + OWN_SPHERE + 3] = -1;
    values[at + PARENT_SPHERE + 3] = -1;
    const children = nodes[base + 12];
    if (children > 0) {
      const first = nodes[base + 11];
      for (let child = 0; child < children; child++)
        foldChild(values, at, (first + child) * BOUND_STRIDE);
      continue;
    }
    const firstPage = nodes[base + 13],
      pageCount = nodes[base + 14];
    for (let i = 0; i < pageCount; i++) foldPage(values, at, pages[firstPage + i]);
  }
  return values;
}
