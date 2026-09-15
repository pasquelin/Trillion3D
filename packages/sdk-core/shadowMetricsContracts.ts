/**
 * Les compteurs d'éclairage et d'ombres d'une image, séparés de `FrameMetrics` par responsabilité.
 * `FrameMetrics` les hérite via `extends` : le contrat public vu des consommateurs (sdk-core/index.ts,
 * le Lab) est inchangé, ces champs restent des propriétés directes de `FrameMetrics`.
 */
export interface ShadowFrameMetrics {
  /** Lampes du contrat `SceneLight` que l'image a éclairées. Null sur un moteur qui les ignore. */
  lightsActive?: number | null;
  /** Tranches d'ombre redessinées par cette image, au plus le plafond publié de l'ordonnanceur.
   *  Zéro est la valeur normale d'une scène immobile : une lampe fixe garde sa tranche. */
  shadowsUpdated?: number | null;
  /**
   * Durées GPU des trois passes de l'éclairage direct, lues par leur étiquette dans le même relevé
   * d'horodatage que `gpuPassMs` : listes de lampes par tuile, atlas d'ombres, résolution différée.
   * Elles décrivent donc l'image de `gpuPassMs.frame`, pas l'image courante, et vaut `null` dès que
   * l'appareil n'expose pas d'horodatage, que le relevé a été tronqué, ou que la passe n'a pas eu
   * lieu — une image sans lampe ne lance ni listes ni ombres. Jamais additionnées à un `cpu*`.
   */
  /** Ce que la passe d'ombres a redessiné : faces (vues) et appels de dessin réellement encodés.
   *  C'est le coût par lampe à ombre, séparé du reste. Null sur un moteur qui ne dessine pas d'ombre. */
  shadowFacesDrawn?: number | null;
  shadowDrawCalls?: number | null;
  /** Ce que l'invalidation par pages a produit : pages redessinées par l'image, pages restées en
   *  file faute de budget, et le retard en millisecondes de la plus ancienne d'entre elles. Zéro
   *  partout est la valeur normale d'une scène immobile ; `null` sur un moteur sans atlas d'ombres. */
  shadowPagesDrawn?: number | null;
  shadowPagesPending?: number | null;
  shadowWaitMs?: number | null;
  gpuLightListsMs?: number | null;
  gpuShadowsMs?: number | null;
  gpuLightingMs?: number | null;
}
