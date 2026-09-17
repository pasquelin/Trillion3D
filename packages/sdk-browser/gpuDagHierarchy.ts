import { CULL_STRIDE } from './gpuDagTypes.ts';
/**
 * La hiérarchie de coupe telle que la descente par niveaux la lit : sa profondeur, et celle qu'une
 * primitive sans hiérarchie reçoit pour que la descente soit le seul chemin de production.
 *
 * Disposition d'un nœud, celle du manifeste : `[0..2]` boîte minimale, `[3..5]` boîte maximale,
 * `[6..9]` sphère, `[10]` plafond d'erreur du remplaçant, `[11]` premier enfant, `[12]` nombre
 * d'enfants, `[13]` première page, `[14]` nombre de pages. Les nœuds sont numérotés par niveaux, la
 * racine au rang zéro : la descente n'a donc qu'à partir de ce rang.
 *
 * La hiérarchie synthétisée ne change aucun verdict : son plafond d'erreur vaut -1, donc aucun de
 * ses nœuds n'est jamais rejeté par l'erreur, et sa boîte est l'union de celles de ses pages — une
 * page sans boîte rend la boîte du nœud infinie, si bien que le tronc ne rejette un nœud que lorsque
 * toutes ses pages portent une boîte qu'il rejette aussi, une à une, comme hier.
 */
const LEAF_PAGES = 32,
  BRANCH = 8,
  STRIDE = CULL_STRIDE,
  INF = Infinity;

type Built = { min: number[]; max: number[]; first: number; pages: number; children: Built[] };

function box(
  pages: ReadonlyArray<{ min?: number[]; max?: number[] }>,
  from: number,
  count: number,
) {
  const min = [INF, INF, INF],
    max = [-INF, -INF, -INF];
  for (let i = from; i < from + count; i++) {
    const rec = pages[i];
    if (!rec.min || !rec.max) return { min: [-INF, -INF, -INF], max: [INF, INF, INF] };
    expand(min, max, rec.min, rec.max);
  }
  return { min, max };
}

/** Étend `[min, max]` à la boîte `[childMin, childMax]`, axe par axe. */
function expand(
  min: number[],
  max: number[],
  childMin: ArrayLike<number>,
  childMax: ArrayLike<number>,
) {
  for (let a = 0; a < 3; a++) {
    if (childMin[a] < min[a]) min[a] = childMin[a];
    if (childMax[a] > max[a]) max[a] = childMax[a];
  }
}

function merge(children: Built[]): Built {
  const min = [INF, INF, INF],
    max = [-INF, -INF, -INF];
  for (const child of children) expand(min, max, child.min, child.max);
  return { min, max, first: 0, pages: 0, children };
}

/** Numérotation par niveaux, racine au rang zéro : `firstChild` d'un nœud est donc contigu. */
function emit(root: Built, count: number) {
  const nodes = new Float64Array(count * STRIDE);
  const queue: Built[] = [root];
  let next = 1;
  for (let at = 0; at < queue.length; at++) {
    const node = queue[at],
      base = at * STRIDE;
    for (let a = 0; a < 3; a++) {
      nodes[base + a] = node.min[a];
      nodes[base + 3 + a] = node.max[a];
    }
    nodes[base + 10] = -1;
    nodes[base + 11] = node.children.length ? next : 0;
    nodes[base + 12] = node.children.length;
    nodes[base + 13] = node.first;
    nodes[base + 14] = node.pages;
    for (const child of node.children) queue.push(child);
    next += node.children.length;
  }
  return { nodes, stride: STRIDE };
}

/** La hiérarchie qu'une primitive sans hiérarchie reçoit : feuilles de trente-deux pages, nœuds de
 *  huit enfants, jusqu'à une racine unique. Une primitive sans page garde une racine feuille vide. */
export function flatHierarchy(pages: ReadonlyArray<{ min?: number[]; max?: number[] }>) {
  let level: Built[] = [];
  for (let first = 0; first < pages.length; first += LEAF_PAGES) {
    const count = Math.min(LEAF_PAGES, pages.length - first);
    const { min, max } = box(pages, first, count);
    level.push({ min, max, first, pages: count, children: [] });
  }
  if (!level.length)
    level.push({ min: [0, 0, 0], max: [0, 0, 0], first: 0, pages: 0, children: [] });
  let total = level.length;
  while (level.length > 1) {
    const up: Built[] = [];
    for (let at = 0; at < level.length; at += BRANCH) up.push(merge(level.slice(at, at + BRANCH)));
    total += up.length;
    level = up;
  }
  return emit(level[0], total);
}

/**
 * Le nombre de nœuds de chaque étage de la hiérarchie, la racine à l'étage zéro. Sa longueur est la
 * profondeur, soit le nombre de passes que la descente demande pour l'épuiser.
 *
 * L'étage `L` MAJORE la file de la passe `L` : cette file ne porte que des enfants de nœuds retenus à
 * l'étage `L-1`, donc que des nœuds de l'étage `L`, et la descente les y écrit compactés à partir de
 * zéro. C'est ce majorant, connu du rangement une fois pour toutes, qui permet de lancer chaque passe
 * de niveau À PLAT : les fils au-delà de la file sortent sur la garde de compte, le mot de tête de
 * l'argument de répartition n'a plus à être recopié vers un tampon d'indirection, et plus rien ne
 * coupe la descente — elle tient dans la passe de tête.
 *
 * LA MESURE QUI LE JUSTIFIE, publiée par `bench/justesse/coupe-lancements-gpu.mjs` et citée d'ici
 * seulement : sur apple metal-3, un niveau de plus coûte environ 26 µs quand il ouvre sa propre
 * passe derrière deux copies hors passe, et environ 1,5 µs quand il est un lancement à plat dans la
 * passe de tête. Le banc republie la pente à chaque exécution ; ces deux valeurs en sont l'ordre.
 * Le banc ne sépare pas la copie de la passe qu'elle coupe, et ne le prétend pas : retirer un
 * armement changerait aussi la taille du lancement, donc le travail fait.
 *
 * Le prix de ces fils qui sortent aussitôt est borné, et le banc le balaie : un étage annoncé à
 * 100 000 nœuds coûte autant qu'un étage de 657, et il faut l'annoncer à 1 000 000 pour retrouver le
 * prix d'un niveau d'avant. L'étage le plus large vaut environ `clusterCount / CULLING_BRANCHING`, si
 * bien que la marge tient jusqu'à des millions de grappes par primitive.
 */
export function hierarchyLevelSizes(nodes: Float64Array, stride: number) {
  const count = nodes.length / stride;
  const sizes: number[] = [];
  if (count < 1) return sizes;
  let frontier = [0];
  while (frontier.length) {
    sizes.push(frontier.length);
    const next: number[] = [];
    for (const node of frontier) {
      const base = node * stride,
        children = nodes[base + 12];
      for (let c = 0; c < children; c++) next.push(nodes[base + 11] + c);
    }
    if (next.length > count) throw new Error('Hierarchie de culling incoherente');
    frontier = next;
  }
  return sizes;
}
