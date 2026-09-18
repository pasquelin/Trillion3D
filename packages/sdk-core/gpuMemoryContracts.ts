/**
 * Ce que le moteur publie de la mémoire qu'il tient sur la carte graphique.
 *
 * WebGPU ne publie pas la mémoire occupée : ces octets sont CALCULÉS par un registre qui voit passer
 * chaque texture et chaque tampon créés sur l'appareil — dimensions, couches, chaîne de mips et
 * format pour une texture, taille pour un tampon — et les rend à la destruction. C'est la somme de
 * ce que le moteur a alloué et n'a pas encore détruit, la seule mesure de mémoire qui ne dépende
 * d'aucun sous-système : un tampon oublié y reste compté. `null` dit « non mesuré », jamais zéro.
 */
export interface GpuMemoryFrameMetrics {
  /** Octets vivants sur l'appareil, toutes allocations confondues. */
  gpuAllocatedBytes?: number | null;
  /** Les mêmes octets, par étiquette d'allocation ; une allocation sans étiquette est nommée
   *  « sans étiquette ». C'est ce qui dit OÙ va la mémoire. */
  gpuAllocatedByLabel?: Record<string, number> | null;
  /** Textures dont le registre ne connaît pas le format : leurs octets manquent au total, et un
   *  total qui en porte ne vaut pas preuve. Zéro est la valeur attendue. */
  gpuAllocationsUnknownFormat?: number | null;
  /** Les cibles d'image de la taille courante — couleur, profondeur, visibilité, HDR, surfaces,
   *  Hi-Z, historique temporel, capture — telles que le budget d'image les a admises. */
  gpuFrameTargetBytes?: number | null;
  /** Le budget d'image que ces cibles doivent tenir, fixe quelle que soit la scène. */
  gpuFrameBudgetBytes?: number | null;
}
