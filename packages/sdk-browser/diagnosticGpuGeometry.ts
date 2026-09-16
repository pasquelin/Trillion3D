import type { DiagnosticGpuVariant } from './diagnosticGpuVariant.ts';

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

/** Vrai quand la variante change un étage de fragments du raster de visibilité. */
export const variesVisibility = (variant?: DiagnosticGpuVariant) =>
  variant === 'geometrie-plat' || variant === 'geometrie-sommets';

/** Vrai quand la variante change l'étage de fragments de la résolution des surfaces. */
export const variesShade = (variant?: DiagnosticGpuVariant) =>
  variant === 'resolution-plate' || variant === 'resolution-identifiants';

/** L'étage de fragments du raster de visibilité, Hi-Z ou non, pour la variante demandée. */
export function visVariantFragment(hiz: boolean, variant?: DiagnosticGpuVariant) {
  const base = hiz ? 'vis_hiz' : 'vis';
  if (variant === 'geometrie-plat') return `${base}_plat_fs`;
  if (variant === 'geometrie-sommets') return `${base}_jete_fs`;
  return `${base}_fs`;
}

/** L'étage de fragments de la résolution des surfaces pour la variante demandée. */
export function shadeVariantFragment(variant?: DiagnosticGpuVariant) {
  if (variant === 'resolution-plate') return 'shade_plat_fs';
  if (variant === 'resolution-identifiants') return 'shade_ids_fs';
  return 'shade_fs';
}

/** Vrai quand la variante n'encode pas la seconde passe de visibilité : les occulteurs seuls. */
export const skipsSecondaryPass = (variant?: DiagnosticGpuVariant) =>
  variant === 'geometrie-une-passe';
