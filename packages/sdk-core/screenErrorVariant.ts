/**
 * EXPÉRIENCE DE MESURE, jamais un chemin de production : la métrique d'erreur écran des clusters,
 * commutable entre la nôtre et celle de la référence externe. Branche `calculs/exp-erreur-ecran`.
 *
 * `certifiee` (défaut) : `screenErrorBound` de `projectionOracles.ts`, un majorant certifié du
 * déplacement écran — plan proche, décalage latéral hors axe, étirement anisotrope compris.
 *
 * `reference` : la projection simple de la sphère d'erreur du cluster, telle que la référence
 * externe la publie — l'erreur objet d'un cluster divisée par sa distance à la caméra, multipliée
 * par le facteur de projection, soit
 *
 *     erreur_pixels ≈ erreur_objet × hauteur_écran / (2 × distance × tan(fov/2))
 *
 * où `hauteur_écran / (2 × tan(fov/2))` est exactement la focale en pixels `focal` que le moteur
 * passe déjà aux deux métriques, et `distance` la profondeur de vue du centre de la sphère. Aucun
 * terme latéral, aucun étirement, une seule garde au plan proche.
 *
 * Source publique de la formule : B. Karis, R. Stubbe et G. Wihlidal, présentation de la référence
 * externe sur la géométrie virtualisée, cours « Advances in Real-Time Rendering in Games »,
 * SIGGRAPH 2021 — section sur le choix de niveau de détail, où l'erreur de simplification d'un
 * cluster est projetée en pixels et comparée à un seuil de l'ordre du pixel.
 *
 * Le commutateur est un état de module, lu par la métrique processeur (`screenErrorBound`, donc
 * tout ce qui en descend) et par le texte WGSL au moment où le nuanceur de sélection est compilé.
 * Chaque côté du banc tourne dans sa propre page : un état de module suffit à les séparer.
 */
export type ScreenErrorVariant = 'certifiee' | 'reference';

let current: ScreenErrorVariant = 'certifiee';

/** Pose la variante pour toute la page. `null`/`undefined` remet la nôtre : aucune session n'hérite. */
export function setScreenErrorVariant(variant: ScreenErrorVariant | null | undefined): void {
  if (variant != null && variant !== 'certifiee' && variant !== 'reference')
    throw new Error('Variante d erreur ecran inconnue');
  current = variant ?? 'certifiee';
}

/** La variante en vigueur. */
export function screenErrorVariant(): ScreenErrorVariant {
  return current;
}

/**
 * L'erreur écran de la référence externe : `erreur × focale / profondeur`, l'infini quand la
 * profondeur du centre n'atteint pas le plan proche. Miroir WGSL dans `gpuDagShaderError.ts`,
 * mêmes opérandes et même ordre, au f32 près. L'appelant a déjà traité l'erreur nulle ou infinie.
 */
export function referenceScreenError(
  error: number,
  depth: number,
  focal: number,
  near: number,
): number {
  if (!(depth > near)) return Infinity;
  return (error * focal) / depth;
}
