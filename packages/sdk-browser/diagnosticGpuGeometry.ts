import type { DiagnosticGpuVariant } from './diagnosticGpuVariant.ts';
import { COMPUTE_ALL, FINE_SPAN } from './gpuRasterContract.ts';

/**
 * DIAGNOSTIC fragment stages of the geometry pass, added to the two visibility modules for
 * these variants only: without a variant, production compiles exactly the previous text. As
 * for blend, each one neutralises ONE factor without touching the encoded commands — same
 * passes, same calls, same order — and the rendered image therefore differs from the
 * production image by construction.
 */

/** The two flat raster stages: without a mask test, then with no fragment at all. */
export const DIAGNOSTIC_VIS_WGSL = `
@fragment fn vis_hiz_plat_fs(in:VSOut)->VisHizOut{var out:VisHizOut;out.id=in.id;out.depth=in.position.z;return out;}
@fragment fn vis_plat_fs(in:VSOut)->@location(0) u32{return in.id;}
@fragment fn vis_hiz_jete_fs(in:VSOut)->VisHizOut{discard;var out:VisHizOut;out.id=0u;out.depth=0.0;return out;}
@fragment fn vis_jete_fs(in:VSOut)->@location(0) u32{discard;return 0u;}`;

/** The two flat resolve stages: reading nothing, then reading only the identifier. */
export const DIAGNOSTIC_SHADE_WGSL = `
@fragment fn shade_plat_fs()->SurfaceOut{return diagnosticSurface(vec3f(0.5),0u);}
@fragment fn shade_ids_fs(@builtin(position) pos:vec4f)->SurfaceOut{
 let packed=textureLoad(vis,vec2i(i32(pos.x),i32(pos.y)),0).r;
 if(packed==0u){return emptySurface();}
 return diagnosticSurface(vec3f(f32(packed&0xffu)/255.0),0u);
}`;

/** Raster-stage suffix (`vis_<suffix>_fs`, `vis_hiz_<suffix>_fs`) that each variant imposes. */
const VIS_STAGE: Partial<Record<DiagnosticGpuVariant, string>> = {
  'geometrie-plat': 'plat',
  'geometrie-sommets': 'jete',
};

/** Surface-resolve stage that each variant imposes. */
const SHADE_STAGE: Partial<Record<DiagnosticGpuVariant, string>> = {
  'resolution-plate': 'shade_plat_fs',
  'resolution-identifiants': 'shade_ids_fs',
};

/** True when the variant changes a fragment stage of the visibility raster. */
export const variesVisibility = (variant?: DiagnosticGpuVariant) =>
  variant !== undefined && variant in VIS_STAGE;

/** True when the variant changes the fragment stage of surface resolve. */
export const variesShade = (variant?: DiagnosticGpuVariant) =>
  variant !== undefined && variant in SHADE_STAGE;

/** Fragment stage of the visibility raster, Hi-Z or not, for the requested variant. */
export function visVariantFragment(hiz: boolean, variant?: DiagnosticGpuVariant) {
  const base = hiz ? 'vis_hiz' : 'vis',
    stage = variant && VIS_STAGE[variant];
  return stage ? `${base}_${stage}_fs` : `${base}_fs`;
}

/** Fragment stage of surface resolve for the requested variant. */
export const shadeVariantFragment = (variant?: DiagnosticGpuVariant) =>
  (variant && SHADE_STAGE[variant]) || 'shade_fs';

/** True when the variant does not encode the second visibility pass: occluders only. */
export const skipsSecondaryPass = (variant?: DiagnosticGpuVariant) =>
  variant === 'geometrie-une-passe';

/** What the variant hands to the compute raster: nothing, the small triangles, or the whole cut. */
export function computeSpanFor(variant?: DiagnosticGpuVariant) {
  if (variant === 'raster-calcul') return COMPUTE_ALL;
  if (variant === 'raster-hybride') return FINE_SPAN;
  return 0;
}

/** True when the variant hands all or part of the opaque geometry to the compute raster. */
export const requestsComputeRaster = (variant?: DiagnosticGpuVariant) =>
  computeSpanFor(variant) > 0;
