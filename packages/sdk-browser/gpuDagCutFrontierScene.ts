/**
 * La scène du comptage de frontière : une pyramide de niveaux de détail, autant de poses, et la
 * hiérarchie de coupe que le rangement leur donne. Aucune dépendance à la bibliothèque de l'hôte —
 * la matrice monde vient de l'appelant —, `test/engineNoThree.test.mjs` l'interdisant à ce fichier.
 */
import { flatHierarchy } from './gpuDagHierarchy.ts';
import type { DagRoot } from './gpuDagTypes.ts';

/** Une page de niveau `level`, posée sur une grille, avec la bande d'erreur de son remplaçant. */
function page(level: number, i: number, cote: number, etendue: number) {
  const rayon = etendue / cote;
  const cx = ((i % cote) / cote - 0.5) * etendue * 2,
    cy = (Math.floor(i / cote) / cote - 0.5) * etendue * 2;
  const parent = level + 1 < 8 ? 2 ** (level + 1) * 0.01 : null;
  return {
    url: `n${level}-${i}`,
    level,
    min: [cx - rayon, cy - rayon, -rayon],
    max: [cx + rayon, cy + rayon, rayon],
    sphere: [cx, cy, 0, rayon],
    lodError: 2 ** level * 0.01,
    parentError: parent,
    parentSphere: parent === null ? null : [cx, cy, 0, rayon * 2],
  };
}

/**
 * La hiérarchie du rangement, dont le plafond d'erreur est rempli : `flatHierarchy` le laisse à -1,
 * ce qui interdit tout élagage par l'erreur. Les nœuds sont numérotés par niveaux, donc les enfants
 * suivent leur parent : un parcours à rebours suffit à remonter le maximum du sous-arbre.
 */
function culling(pages: ReturnType<typeof page>[], parNiveaux: boolean) {
  const { nodes, stride } = parNiveaux ? hierarchieParNiveaux(pages) : flatHierarchy(pages);
  const count = nodes.length / stride;
  for (let n = count - 1; n >= 0; n--) {
    const base = n * stride;
    let plafond = 0;
    const enfants = nodes[base + 12];
    for (let c = 0; c < enfants; c++) {
      const fils = nodes[(nodes[base + 11] + c) * stride + 10];
      plafond = fils < 0 || plafond < 0 ? -1 : Math.max(plafond, fils);
    }
    for (let p = 0; p < nodes[base + 14]; p++) {
      const erreur = pages[nodes[base + 13] + p].parentError;
      plafond = erreur === null || plafond < 0 ? -1 : Math.max(plafond, erreur);
    }
    nodes[base + 10] = plafond;
  }
  return { nodes, stride };
}

/** `niveaux` étages de détail, chacun deux fois moins peuplé que le précédent. */
export function scenePages(feuilles: number, niveaux: number) {
  const pages: ReturnType<typeof page>[] = [];
  for (let level = niveaux - 1; level >= 0; level--) {
    const compte = Math.max(1, feuilles >> level),
      cote = Math.ceil(Math.sqrt(compte));
    for (let i = 0; i < compte; i++) pages.push(page(level, i, cote, 3));
  }
  return pages;
}

/**
 * La hiérarchie que le compilateur produit (`dag/culling.rs`, `build_culling_bvh`) : la racine est
 * partagée en UN NŒUD PAR ÉTAGE DE DÉTAIL, puis chaque étage reçoit sa propre hiérarchie spatiale.
 * Tout nœud sous la racine ne porte donc qu'un seul étage — c'est ce qui décide si un rejet par le
 * plancher d'erreur peut porter, un nœud à cheval sur deux étages ayant pour plancher celui de son
 * étage le plus fin. Les pages arrivent déjà rangées par étage.
 *
 * Renumérotation : le nœud `j` du bloc `k` va en `1+k` s'il est la racine du bloc, sinon derrière
 * toutes ces racines. Les enfants d'un nœud restent contigus et derrière lui, ce que `cullingBounds`
 * et `hierarchyLevelSizes` demandent tous deux.
 */
function hierarchieParNiveaux(pages: ReturnType<typeof page>[]) {
  const STRIDE = 15;
  const tranches: number[][] = [];
  for (let i = 0, debut = 0; i <= pages.length; i++)
    if (i === pages.length || pages[i].level !== pages[debut].level) {
      tranches.push([debut, i]);
      debut = i;
    }
  const blocs = tranches.map(([de, a]) => ({
    arbre: flatHierarchy(pages.slice(de, a)),
    premierePage: de,
  }));
  let total = 1;
  const bases = blocs.map((bloc) => {
    const base = total;
    total += bloc.arbre.nodes.length / STRIDE - 1;
    return base;
  });
  const nodes = new Float64Array((total + blocs.length) * STRIDE);
  const corps = 1 + blocs.length;
  for (let a = 0; a < 3; a++) {
    nodes[a] = Infinity;
    nodes[3 + a] = -Infinity;
  }
  nodes[11] = 1;
  nodes[12] = blocs.length;
  for (let k = 0; k < blocs.length; k++) {
    const { arbre, premierePage } = blocs[k];
    const compte = arbre.nodes.length / STRIDE;
    const place = (j: number) => (j === 0 ? 1 + k : corps - 1 + bases[k] + j - 1);
    for (let j = 0; j < compte; j++) {
      const de = j * STRIDE,
        vers = place(j) * STRIDE;
      for (let v = 0; v < STRIDE; v++) nodes[vers + v] = arbre.nodes[de + v];
      nodes[vers + 11] = arbre.nodes[de + 12] ? place(arbre.nodes[de + 11]) : 0;
      nodes[vers + 13] = arbre.nodes[de + 13] + premierePage;
      for (let a = 0; a < 3; a++) {
        if (j === 0 && arbre.nodes[de + a] < nodes[a]) nodes[a] = arbre.nodes[de + a];
        if (j === 0 && arbre.nodes[de + 3 + a] > nodes[3 + a])
          nodes[3 + a] = arbre.nodes[de + 3 + a];
      }
    }
  }
  return { nodes, stride: STRIDE };
}

/** Les poses de la scène. La matrice monde vient de l'appelant : ce module ne connaît pas la
 *  bibliothèque de l'hôte, et la liste fermée de `test/engineNoThree.test.mjs` le lui interdit. */
export function sceneRoots(
  pages: ReturnType<typeof page>[],
  mondes: DagRoot['world'][],
  parNiveaux = false,
): DagRoot[] {
  const cull = culling(pages, parNiveaux);
  return mondes.map((world) => ({ world, pages: pages as DagRoot['pages'], culling: cull }));
}
