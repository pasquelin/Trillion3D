import type { DiagnosticDetail } from './backendTypes.ts';

/**
 * Les variantes de DIAGNOSTIC de la carte graphique. Elles n'existent que pour ventiler une durée :
 * chacune neutralise UN facteur de l'image sans toucher aux commandes encodées — mêmes passes,
 * mêmes appels de dessin, même ordre, même tri. L'image rendue DIFFÈRE donc de l'image de
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
@fragment fn fsPlat()->@location(0) vec4f{return vec4f(0.5,0.5,0.5,0.5);}
@fragment fn fsJete()->@location(0) vec4f{discard;return vec4f(0.0);}`;

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
