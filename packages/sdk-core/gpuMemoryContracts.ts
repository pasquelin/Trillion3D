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
   *  Hi-Z, historique temporel, capture. Elles suivent la résolution : aucun budget ne les borne. */
  gpuFrameTargetBytes?: number | null;
  /** Le pool de pages de géométrie : octets demandés par l'hôte, fentes de page que le réservoir
   *  en tire, octets alloués. Fixe quelle que soit la scène, comme chez la référence. */
  geometryPoolBytes?: number | null;
  geometryPoolSlots?: number | null;
  geometryPoolAllocatedBytes?: number | null;
  /** Pourquoi le réservoir ne fait pas la taille demandée : `root-cover` (relevé jusqu'à la
   *  couverture racine), `scene` (la scène est plus petite), `page-cap` (plafond en pages),
   *  `device-limit` (limite de l'appareil), `ceiling` (plafond de la session) ; `null` quand il la
   *  fait. */
  geometryPoolClamp?: string | null;
  /** Pages que l'image tient — couverture, coupe, ancêtres dessinés — au-delà des fentes du
   *  réservoir : elles s'affichent par leur ancêtre résident, et la coupe grossit jusqu'à tenir.
   *  Zéro est l'état normal ; un compte qui dure dit que le budget est trop petit pour cette vue. */
  geometryPoolSaturated?: number | null;
  /** Pourquoi le pool de textures ne fait pas la taille demandée : `minimum` (relevé à une couche
   *  par atlas), `device-limit` ; `null` quand il la fait. */
  texturePoolClamp?: string | null;
}
