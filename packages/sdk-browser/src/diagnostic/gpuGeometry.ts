import type { DiagnosticGpuVariant } from './gpuVariant.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { unorm8 } from '../../../math/src/wgsl/color.ts'
import { VIS_FRAGMENT, VIS_UNMASKED } from '../visibility/shader/visWgsl.ts'

/**
 * DIAGNOSTIC stages of the geometry pass — the raster's fragment, the resolve's compute stage —,
 * added to the two visibility modules for
 * these variants only: without a variant, production compiles exactly the previous text. As
 * for blend, each one neutralises ONE factor without touching the encoded commands — same
 * passes, same calls, same order — and the rendered image therefore differs from the
 * production image by construction.
 */

/** The raster stage with no fragment at all: on a device without the 64-bit atomic maximum, its
 *  fragments write the attachments (`VIS_OUT_WGSL`), so the stage returns the output it discards.
 *  The one without a mask test is production's own stage under \`VIS_UNMASKED\`
 *  (\`../visibility/shader/visWgsl.ts\`). */
export const diagnosticVisWgsl = (wide: boolean) =>
  wgslBlock(
    `DIAGNOSTIC_VIS_WGSL(${wide ? 'wide' : 'split'})`,
    [],
    wide
      ? `
@fragment fn vis_hiz_jete_fs(in:VSOut){discard;}`
      : `
@fragment fn vis_hiz_jete_fs(in:VSOut)->VisOut{return visLeft();}`,
  )

/** The two flat resolve stages, each over its class's bin as the resolve's (`binnedPixel`):
 *  one grey surface, then the identifier's low byte. */
export const DIAGNOSTIC_SHADE_WGSL = wgslBlock(
  'DIAGNOSTIC_SHADE_WGSL',
  [unorm8],
  `
@compute @workgroup_size(SHADE_BIN_GROUP) fn shade_plat_cs(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let at=binnedPixel(group,n,lane);
 if(!shadesPixel(at)){return;}
 storeSurface(at.xy,diagnosticSurface(vec3f(0.5),0u));
}
@compute @workgroup_size(SHADE_BIN_GROUP) fn shade_ids_cs(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let at=binnedPixel(group,n,lane);
 if(!shadesPixel(at)){return;}
 storeSurface(at.xy,diagnosticSurface(vec3f(unorm8(textureLoad(vis,vec2i(at.xy),0).r,0u)),0u));
}`,
)

/** The raster's fragment stage: its entry point and overrides, and whether it draws no fragment
 *  at all — then the voxel slots draw none either (`../visibility/passes/pipelines.ts`). */
type VisStage = { entryPoint: string; constants?: Record<string, number>; fragmentless?: true }

/** Raster stage that each variant imposes: `geometry-flat` the one stage with its mask test
 *  compiled out, `geometry-vertices` the stage with no fragment. */
const VIS_STAGE: Partial<Record<DiagnosticGpuVariant, VisStage>> = {
  'geometry-flat': { entryPoint: VIS_FRAGMENT, constants: VIS_UNMASKED },
  'geometry-vertices': { entryPoint: 'vis_hiz_jete_fs', fragmentless: true },
}

/** Surface-resolve stage that each variant imposes. */
const SHADE_STAGE: Partial<Record<DiagnosticGpuVariant, string>> = {
  'resolve-flat': 'shade_plat_cs',
  'resolve-ids': 'shade_ids_cs',
}

/** True when the variant changes a fragment stage of the visibility raster. */
export const variesVisibility = (variant?: DiagnosticGpuVariant) =>
  variant !== undefined && variant in VIS_STAGE

/** True when the variant changes the stage of surface resolve. */
export const variesShade = (variant?: DiagnosticGpuVariant) =>
  variant !== undefined && variant in SHADE_STAGE

/** Fragment stage of the visibility raster for the requested variant: each writes the identifier
 *  and the pyramid's level 0. */
export const visVariantFragment = (variant?: DiagnosticGpuVariant): VisStage =>
  (variant && VIS_STAGE[variant]) || { entryPoint: VIS_FRAGMENT }

/** Compute stage of surface resolve for the requested variant. */
export const shadeVariantEntry = (variant?: DiagnosticGpuVariant) =>
  (variant && SHADE_STAGE[variant]) || 'shade_cs'

/** True when the variant does not encode the second visibility pass: occluders only. */
export const skipsSecondaryPass = (variant?: DiagnosticGpuVariant) =>
  variant === 'geometry-one-pass'
