export const treeFr = {
  multiplyMatrix4Batch: {
    description:
      '`n` produits `out[i] = a[i] · b[i]`, sur des sous-vues de seize nombres créées une seule fois. Un noyau WebAssembly répète la même formule et le gouverneur choisit le chemin mesuré le plus rapide.',
  },
  boxTransformBatch: {
    description:
      '`n` boîtes transformées par `n` matrices. `out` et `boxes` portent six nombres par élément, `mats` une sous-vue de seize.',
  },
  hierarchyUpdateBatch: {
    description:
      'Met à jour une hiérarchie complète en une passe, parents avant enfants : composition locale puis multiplication par la matrice monde du parent. `parents[i]` doit désigner un nœud déjà mis à jour ; toute autre valeur crée une racine.',
  },
  createPathGovernor: {
    description:
      'Arbitre JS contre WebAssembly par opération : médianes glissantes en nanosecondes par élément, bascule après cinq avances consécutives, puis rééchantillonnage périodique de l’autre chemin.',
  },
  frustumKeepsBoxBatch: {
    description:
      '`n` boîtes de six nombres (min puis max) contre les vingt-quatre flottants d’un frustum : `kept[i]` vaut 1 où la boîte coupe ou tient dans le volume, et le nombre gardé est renvoyé — `frustumExcludesBox` inversé, la polarité de la référence. Le lot de sphères écrit quatre nombres par boîte, centre puis rayon jusqu’au coin, comme `sphereFromBounds`.',
  },
  boxUnionBatch: {
    description:
      '`into` agrandi de `n` boîtes, ou de `n` boîtes chacune transformée par sa matrice d’abord — une passe, une boîte de brouillon, aucune allocation. Les deux répètent `boxUnion`, le second `boxTransform` avant : les bornes monde d’une scène entière en un appel.',
  },
  invertMatrix4Batch: {
    description:
      '`n` inverses, `n` matrices normales de neuf nombres, `n` compositions `T · R · S`, `n` décompositions. Une matrice de déterminant nul est inversée en identité et signalée dans `singular[i]` — jamais d’exception au milieu d’un lot. `composeMatrix4Batch` prend tout à plat ou tout en sous-vues, et tranche la forme avant la boucle.',
  },
  transformPointsBatch: {
    description:
      '`n` points de trois nombres par une matrice affine, ou une matrice par point ; `n` directions par le bloc 3×3 supérieur puis normalisées, translation ignorée. Ils répètent `transformAffinePoint` et `transformDirectionVector3`.',
  },
  srgbToLinearBatch: {
    description:
      'Un canal par élément, les courbes exactes de `mathColor.ts` : la référence multiplie par des constantes arrondies, et l’écart — invisible sur 8 bits — est borné une fois, dans le banc qui les oppose.',
  },
  createTransformTree: {
    description:
      'Hiérarchie de transformations orientée données : un nœud est un indice dans des tableaux plats de parent, pose, matrices et drapeaux. Les vues locales et monde sont créées à la croissance, jamais pendant une mise à jour.',
  },
  setNodePosition: {
    description:
      'Les écritures passent par les setters, qui marquent leurs changements. En mise à jour automatique, la prochaine visite recompose la matrice locale depuis la pose ; `setNodeAutoUpdate(..., false)` conserve la matrice fournie.',
  },
  reparentTransformNode: {
    description:
      'Attache `node` sous `parent` (`-1` pour une racine) et refuse un parent égal au nœud ou à l’un de ses descendants. La suppression retire aussi les descendants et leurs indices seront réutilisés.',
  },
  updateNodeMatrixWorld: {
    description:
      'Met à jour le nœud puis tout son sous-arbre, parents d’abord. Un nœud est visité s’il est automatique, marqué ou forcé. La seconde forme parcourt aussi les ancêtres depuis la racine.',
  },
  nodeWorldPosition: {
    description:
      'Lectures de la matrice monde : position, rotation, échelle et direction. Un déterminant négatif est porté par `x`; une caméra ou une lumière regarde vers `−z`. `nodeWorldMirrorsFaces` indique si les faces avant et arrière doivent être échangées.',
  },
  lookAtNode: {
    description:
      'Oriente `node` vers le point monde `(x, y, z)`. Une caméra ou une lumière regarde par `−z`, un objet présente `+z`. Les ancêtres puis le nœud sont mis à jour avant le calcul.',
  },
};
