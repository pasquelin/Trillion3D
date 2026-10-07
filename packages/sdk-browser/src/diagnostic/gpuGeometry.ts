import type { DiagnosticGpuVariant } from './gpuVariant.ts'
import { COMPUTE_ALL, FINE_SPAN } from '../gpu/raster/contract.ts'

/**
 * DIAGNOSTIC fragment stages of the geometry pass, added to the two visibility modules for
 * these variants only: without a variant, production compiles exactly the previous text. As
 * for blend, each one neutralises ONE factor without touching the encoded commands — same
 * passes, same calls, same order — and the rendered image therefore differs from the
 * production image by construction.
 */

/** The raster stage with no fragment at all. The one without a mask test is production's
 *  \`vis_hiz_opaque_fs\`, which every slot without a cutout row draws with. */
export const DIAGNOSTIC_VIS_WGSL = `
@fragment fn vis_hiz_jete_fs(in:VSOut)->VisHizOut{discard;var out:VisHizOut;out.id=0u;out.depth=0.0;return out;}`

/** The two flat resolve stages: reading only the pixel's class (`classAdmits`, which every
 *  resolve stage asks: no depth target keeps another class's pixels), then the identifier. */
export const DIAGNOSTIC_SHADE_WGSL = `
@fragment fn shade_plat_fs(@builtin(position) pos:vec4f)->SurfaceOut{
 if(!classAdmits(textureLoad(vis,vec2i(i32(pos.x),i32(pos.y)),0).r)){discard;}
 return diagnosticSurface(vec3f(0.5),0u);
}
@fragment fn shade_ids_fs(@builtin(position) pos:vec4f)->SurfaceOut{
 let packed=textureLoad(vis,vec2i(i32(pos.x),i32(pos.y)),0).r;
 if(!classAdmits(packed)){discard;}
 return diagnosticSurface(vec3f(f32(packed&0xffu)/255.0),0u);
}`

/** Raster-stage suffix (`vis_hiz_<suffix>_fs`) that each variant imposes. */
const VIS_STAGE: Partial<Record<DiagnosticGpuVariant, string>> = {
  'geometry-flat': 'opaque',
  'geometry-vertices': 'jete',
}

/** Surface-resolve stage that each variant imposes. */
const SHADE_STAGE: Partial<Record<DiagnosticGpuVariant, string>> = {
  'resolve-flat': 'shade_plat_fs',
  'resolve-ids': 'shade_ids_fs',
}

/** True when the variant changes a fragment stage of the visibility raster. */
export const variesVisibility = (variant?: DiagnosticGpuVariant) =>
  variant !== undefined && variant in VIS_STAGE

/** True when the variant changes the fragment stage of surface resolve. */
export const variesShade = (variant?: DiagnosticGpuVariant) =>
  variant !== undefined && variant in SHADE_STAGE

/** Fragment stage of the visibility raster for the requested variant: each writes the identifier
 *  and the pyramid's level 0. */
export function visVariantFragment(variant?: DiagnosticGpuVariant) {
  const stage = variant && VIS_STAGE[variant]
  return stage ? `vis_hiz_${stage}_fs` : 'vis_hiz_fs'
}

/** The raster stage without a mask test: production's on a draw that holds no cutout row
 *  (`../webgpu/visibility/pipelines.ts`), and `geometry-flat`'s on every draw. */
export const visOpaqueFragment = () => visVariantFragment('geometry-flat')

/** Fragment stage of surface resolve for the requested variant. */
export const shadeVariantFragment = (variant?: DiagnosticGpuVariant) =>
  (variant && SHADE_STAGE[variant]) || 'shade_fs'

/** True when the variant does not encode the second visibility pass: occluders only. */
export const skipsSecondaryPass = (variant?: DiagnosticGpuVariant) =>
  variant === 'geometry-one-pass'

/** What the variant hands to the compute raster: nothing, the small triangles, or the whole cut. */
export function computeSpanFor(variant?: DiagnosticGpuVariant) {
  if (variant === 'raster-compute') return COMPUTE_ALL
  if (variant === 'raster-hybrid') return FINE_SPAN
  return 0
}

/** True when the variant hands all or part of the opaque geometry to the compute raster. */
export const requestsComputeRaster = (variant?: DiagnosticGpuVariant) => computeSpanFor(variant) > 0
