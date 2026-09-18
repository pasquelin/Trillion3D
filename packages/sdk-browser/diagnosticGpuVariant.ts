import type { DiagnosticDetail } from './backendTypes.ts';

/**
 * Les variantes de DIAGNOSTIC de la carte graphique. Elles n'existent que pour ventiler une durée :
 * chacune neutralise UN facteur de l'image sans toucher aux commandes encodées — mêmes passes,
 * mêmes appels de dessin, même ordre, même tri — à trois exceptions déclarées : la coupe doublée
 * réencode sa sélection, `geometrie-une-passe` retire la seconde passe de visibilité, et
 * `raster-calcul` et `raster-hybride` confient tout ou partie de la géométrie opaque au raster de
 * calcul ; leurs durées ne se soustraient pas comme les autres. L'image rendue DIFFÈRE donc de l'image de
 * production par construction : aucune n'est une optimisation, aucune ne se mesure en fidélité, et
 * aucun chemin de production n'en allume une. Le seul moyen est `diagnosticGpuVariant` de
 * `createExplorer`, refusée hors `diagnosticDetail: 'trace'`.
 */
export const DIAGNOSTIC_GPU_VARIANTS = [
  /** L'étage de fragments du mélange rend une couleur constante : ni texture, ni éclairage. */
  'transparents-plat',
  /** L'étage de fragments écarte immédiatement : il ne reste que les sommets et la rasterisation. */
  'transparents-sommets',
  /** L'étage de fragments complet, sans aucune écriture de couleur (masque à zéro). */
  'transparents-sans-couleur',
  /** Fragments constants, sans écriture, comptés par requête d'occlusion : le taux de recouvrement. */
  'transparents-surdessin',
  /** La composition n'écrit plus la vue de la chaîne d'échange : présentation hors écran. */
  'presentation-hors-ecran',
  /** Toute la coupe est encodée DEUX fois. Chaque noyau repart de la remise à zéro, donc l'état
   *  final et l'image sont ceux d'une seule exécution : l'écart d'image est le coût vrai de la
   *  sélection, attentes entre lancements comprises, que nulle enveloppe de passe ne rapporte. */
  'selection-doublee',
  /** La tête de la coupe — préparation, nœuds, grappes voulues — encodée deux fois, elle aussi
   *  idempotente. Par soustraction avec la précédente, la queue : escalades, masque, compaction. */
  'selection-tete-doublee',
  /** Le raster de visibilité n'applique plus le masque d'opacité : ni lecture d'atlas, ni rejet. */
  'geometrie-plat',
  /** Le raster de visibilité écarte immédiatement : il ne reste que les sommets et les triangles. */
  'geometrie-sommets',
  /** La seconde passe de visibilité n'est pas encodée : les occulteurs seuls. */
  'geometrie-une-passe',
  /** Le raster de calcul dessine TOUTE la coupe opaque et masquée, comme b72278c6 le faisait en
   *  production ; sans elle, le raster matériel dessine. Deux côtés qui ne diffèrent que par elle
   *  donnent, à la même taille, l'enveloppe et l'écart d'image du calcul contre le matériel. */
  'raster-calcul',
  /** Le partage de la référence : les triangles de la classe fine du raster — une boîte de trois
   *  pixels de côté au plus — au raster de calcul, tous les autres au matériel. C'est le candidat
   *  à la production ; il n'y entre que si l'enveloppe le dit. */
  'raster-hybride',
  /** La résolution des surfaces ne lit rien et rend une valeur constante. */
  'resolution-plate',
  /** La résolution des surfaces ne lit que le tampon de visibilité, sans matériau ni atlas. */
  'resolution-identifiants',
] as const;

export type DiagnosticGpuVariant = (typeof DIAGNOSTIC_GPU_VARIANTS)[number];

/** Vérifie la variante demandée et le détail sous lequel elle est permise. Hors `trace`, refus. */
export function resolveDiagnosticGpuVariant(
  variant: string | undefined,
  detail: DiagnosticDetail | undefined,
): DiagnosticGpuVariant | undefined {
  if (variant === undefined) return undefined;
  if (!(DIAGNOSTIC_GPU_VARIANTS as readonly string[]).includes(variant))
    throw new Error(`DIAGNOSTIC_GPU_VARIANT_UNKNOWN: ${variant}`);
  if (detail !== 'trace') throw new Error('DIAGNOSTIC_GPU_VARIANT_REQUIRES_TRACE');
  return variant as DiagnosticGpuVariant;
}

/** Les deux étages de fragments de diagnostic, ajoutés au module de mélange pour ces variantes
 *  seulement : sans variante, la production compile exactement le module d'avant. */
export const DIAGNOSTIC_BLEND_WGSL = `
@fragment fn fsPlat()->BlendOut{return BlendOut(vec4f(0.5,0.5,0.5,0.5),0u);}
@fragment fn fsJete()->BlendOut{discard;return BlendOut(vec4f(0.0),0u);}`;

/** L'étage de fragments et le masque d'écriture d'une variante, pour la passe de mélange. */
export function blendVariantPipeline(variant: DiagnosticGpuVariant | undefined) {
  switch (variant) {
    case 'transparents-plat':
      return { entryPoint: 'fsPlat', writeMask: 0xf };
    case 'transparents-sommets':
      return { entryPoint: 'fsJete', writeMask: 0xf };
    case 'transparents-sans-couleur':
      return { entryPoint: 'fs', writeMask: 0 };
    case 'transparents-surdessin':
      return { entryPoint: 'fsPlat', writeMask: 0 };
    default:
      return { entryPoint: 'fs', writeMask: 0xf };
  }
}

/** Vrai quand la variante compte les fragments du mélange par requête d'occlusion. */
export const countsBlendOverdraw = (variant?: DiagnosticGpuVariant) =>
  variant === 'transparents-surdessin';

/** Vrai quand la variante compose hors écran : la chaîne d'échange n'est pas touchée de l'image. */
export const composesOffscreen = (variant?: DiagnosticGpuVariant) =>
  variant === 'presentation-hors-ecran';

/** Ce que la variante fait encoder deux fois dans la coupe : tout, sa tête seule, ou rien. */
export const selectionRepeat = (variant?: DiagnosticGpuVariant) =>
  variant === 'selection-doublee' ? 'tout' : variant === 'selection-tete-doublee' ? 'tete' : null;
