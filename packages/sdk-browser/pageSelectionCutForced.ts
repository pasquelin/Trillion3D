import type { ClusterStructureIndex } from './pageSelectionTypes.ts';

/**
 * Liens ascendants de la hiérarchie de culling : le parent de chaque nœud, le nœud feuille de
 * chaque cluster. La forme du DAG ne dépend d'aucune matrice monde : ces deux tableaux sont
 * calculés une fois par primitive et partagés par toutes ses instances.
 *
 * Ils servent une seule chose : savoir, sans balayer un sous-arbre, si un groupe forcé le touche.
 * Le repli par forçage ne teste pas la coupe mais le groupe forcé — un sous-arbre qu'aucun groupe
 * forcé ne touche décide donc comme la coupe ordinaire, et un sous-arbre touché se descend.
 */
export type CullingLinks = { parents: Int32Array; leafOfPage: Int32Array };

/** Marques de forçage d'une instance : combien de clusters forcés chaque sous-arbre contient.
 *  Zéro vaut « aucun groupe forcé ici », la seule lecture que la descente en fait. */
export type ForcedMarks = Int32Array;

export function cullingLinks(
  { nodes, stride }: { nodes: Float64Array; stride: number },
  pages: number,
): CullingLinks {
  const count = (nodes.length / stride) | 0;
  const parents = new Int32Array(count).fill(-1),
    leafOfPage = new Int32Array(pages).fill(-1);
  for (let node = 0; node < count; node++) {
    const base = node * stride,
      children = nodes[base + 12];
    if (children > 0) {
      const first = nodes[base + 11];
      for (let child = 0; child < children; child++) parents[first + child] = node;
      continue;
    }
    const firstPage = nodes[base + 13],
      pageCount = nodes[base + 14];
    for (let i = 0; i < pageCount; i++) leafOfPage[firstPage + i] = node;
  }
  return { parents, leafOfPage };
}

/** Porte un cluster et ses ancêtres à la marque `delta`. Un cluster hors hiérarchie ne porte rien. */
function markPage(links: CullingLinks, marks: ForcedMarks, page: number, delta: number) {
  let node = links.leafOfPage[page];
  while (node >= 0) {
    marks[node] += delta;
    node = links.parents[node];
  }
}

/**
 * Marque (`delta` 1) ou démarque (`delta` -1) les nœuds que ce groupe touche : ceux dont le
 * sous-arbre contient un cluster que le groupe produit ou un cluster qu'il remplace. Ce sont
 * exactement les deux lectures que `drawnUnderForcing` fait du tableau des groupes forcés,
 * `forced[source]` et `forced[group]` ; hors de ces sous-arbres, le forçage ne change rien.
 *
 * Le coût est celui des clusters du groupe, multiplié par la profondeur de la hiérarchie : un
 * groupe forcé en touche quelques dizaines, jamais la primitive entière.
 *
 * Les liens de groupes du manifeste sont la seule source : `outputs` nomme les clusters dont
 * `source` est ce groupe, `children` ceux dont `group` l'est. C'est la correspondance dont
 * `forceCoarse` vit déjà — il empile `pages[structure.outputs[i]]` puis relit `rec.group` —,
 * pas une seconde table dérivée des fiches.
 */
export function markForcedGroup(
  links: CullingLinks,
  marks: ForcedMarks,
  structure: ClusterStructureIndex,
  group: number,
  delta: number,
) {
  const { childOffsets, children, outputOffsets, outputs } = structure;
  for (let i = childOffsets[group]; i < childOffsets[group + 1]; i++)
    markPage(links, marks, children[i], delta);
  for (let i = outputOffsets[group]; i < outputOffsets[group + 1]; i++)
    markPage(links, marks, outputs[i], delta);
}
