import type { DiagnosticGpuVariant } from './diagnosticGpuVariant.ts';
import { COMPUTE_ALL, FINE_SPAN } from './gpuRasterContract.ts';

/**
 * Les étages de fragments de DIAGNOSTIC de la passe de géométrie, ajoutés aux deux modules de
 * visibilité pour ces variantes seulement : sans variante, la production compile exactement le
 * texte d'avant. Comme pour le mélange, chacune neutralise UN facteur sans toucher aux commandes
 * encodées — mêmes passes, mêmes appels, même ordre —, et l'image rendue diffère donc de l'image
 * de production par construction.
 */

/** Les deux étages plats du raster : sans test de masque, puis sans fragment du tout. */
export const DIAGNOSTIC_VIS_WGSL = `
@fragment fn vis_hiz_plat_fs(in:VSOut)->VisHizOut{var out:VisHizOut;out.id=in.id;out.depth=in.position.z;return out;}
@fragment fn vis_plat_fs(in:VSOut)->@location(0) u32{return in.id;}
@fragment fn vis_hiz_jete_fs(in:VSOut)->VisHizOut{discard;var out:VisHizOut;out.id=0u;out.depth=0.0;return out;}
@fragment fn vis_jete_fs(in:VSOut)->@location(0) u32{discard;return 0u;}`;

/** Les deux étages plats de la résolution : sans rien lire, puis en ne lisant que l'identifiant. */
export const DIAGNOSTIC_SHADE_WGSL = `
@fragment fn shade_plat_fs()->SurfaceOut{return diagnosticSurface(vec3f(0.5));}
@fragment fn shade_ids_fs(@builtin(position) pos:vec4f)->SurfaceOut{
 let packed=textureLoad(vis,vec2i(i32(pos.x),i32(pos.y)),0).r;
 if(packed==0u){return emptySurface();}
 return diagnosticSurface(vec3f(f32(packed&0xffu)/255.0));
}`;

/** Le suffixe d'étage du raster (`vis_<suffixe>_fs`, `vis_hiz_<suffixe>_fs`) que chaque variante impose. */
const VIS_STAGE: Partial<Record<DiagnosticGpuVariant, string>> = {
  'geometrie-plat': 'plat',
  'geometrie-sommets': 'jete',
};

/** L'étage de la résolution des surfaces que chaque variante impose. */
const SHADE_STAGE: Partial<Record<DiagnosticGpuVariant, string>> = {
  'resolution-plate': 'shade_plat_fs',
  'resolution-identifiants': 'shade_ids_fs',
};

/** Vrai quand la variante change un étage de fragments du raster de visibilité. */
export const variesVisibility = (variant?: DiagnosticGpuVariant) =>
  variant !== undefined && variant in VIS_STAGE;

/** Vrai quand la variante change l'étage de fragments de la résolution des surfaces. */
export const variesShade = (variant?: DiagnosticGpuVariant) =>
  variant !== undefined && variant in SHADE_STAGE;

/** L'étage de fragments du raster de visibilité, Hi-Z ou non, pour la variante demandée. */
export function visVariantFragment(hiz: boolean, variant?: DiagnosticGpuVariant) {
  const base = hiz ? 'vis_hiz' : 'vis',
    stage = variant && VIS_STAGE[variant];
  return stage ? `${base}_${stage}_fs` : `${base}_fs`;
}

/** L'étage de fragments de la résolution des surfaces pour la variante demandée. */
export const shadeVariantFragment = (variant?: DiagnosticGpuVariant) =>
  (variant && SHADE_STAGE[variant]) || 'shade_fs';

/** Vrai quand la variante n'encode pas la seconde passe de visibilité : les occulteurs seuls. */
export const skipsSecondaryPass = (variant?: DiagnosticGpuVariant) =>
  variant === 'geometrie-une-passe';

/** Ce que la variante confie au raster de calcul : rien, les petits triangles, ou toute la coupe. */
export function computeSpanFor(variant?: DiagnosticGpuVariant) {
  if (variant === 'raster-calcul') return COMPUTE_ALL;
  if (variant === 'raster-hybride') return FINE_SPAN;
  return 0;
}

/** Vrai quand la variante confie tout ou partie de la géométrie opaque au raster de calcul. */
export const requestsComputeRaster = (variant?: DiagnosticGpuVariant) =>
  computeSpanFor(variant) > 0;
