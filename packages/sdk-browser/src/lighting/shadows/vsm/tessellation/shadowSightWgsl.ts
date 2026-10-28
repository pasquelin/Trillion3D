import { wgslBlock, wgslVariants } from '../../../../../../math/src/wgsl/decl.ts'
import { OCCLUSION_MAIN, OCCLUSION_NONE } from '../../../../visibility/tessellation/contract.ts'
import { vsmOcclusionHiddenWgsl } from '../occlusion/occlusionTestWgsl.ts'
import { VSM_RENDER_RECORD_WGSL } from '../render/renderParamsWgsl.ts'
import { binMarksWgsl } from '../render/renderBinWgsl.ts'
import { VSM_TESS_VIEW_WGSL } from './shadowViewWgsl.ts'

/** The group the occlusion's textures are bound at in the tessellation's programs: the pyramid, the kept page table, the marks and the stale rects. */
const VSM_TESS_OCCLUSION_GROUP = 3

/**
 * THE SIGHT OF A SHADOW PATCH (`vsmPatchHidden`, over what its record gives all its patches, `vsmPatchSightOf`), the occlusion test of a patch by its map's pyramid, the render cull's own test of a
 * caster (`../occlusion/occlusionTestWgsl.ts`) on the patch's box (`vsmPatchBox`, `shadowViewWgsl.ts`): the main pass (`OCCLUSION_MAIN`)
 * tests the box, at the placement's pose now, under the map's previous view against the previous frame's pyramid (`vsmHiddenBefore`),
 * where the map has one for the mip, and hides what it hides — the pass keeps those patches for the post pass (`occludePatch`) —; the post
 * pass (`OCCLUSION_POST`) tests it against this frame's, built from what the main pass drew (`vsmHiddenNow`), on every page the record's
 * marks name, and drops what it hides. A box short of the near plane is never hidden, and a pass with no pyramid (`OCCLUSION_NONE`) hides
 * nothing. The records name the map, its mip, its layer and its marks; the pyramid and the kept tables are group `VSM_TESS_OCCLUSION_GROUP`.
 */
export const vsmPatchSightWgsl = wgslVariants((prefiltered: boolean) =>
  wgslBlock(
    prefiltered ? 'VSM_PATCH_SIGHT_PREFILTERED_WGSL' : 'VSM_PATCH_SIGHT_WGSL',
    [
      VSM_TESS_VIEW_WGSL,
      VSM_RENDER_RECORD_WGSL,
      binMarksWgsl(prefiltered),
      vsmOcclusionHiddenWgsl(VSM_TESS_OCCLUSION_GROUP),
    ],
    `struct VsmPatchSight{pd:VsmProjectionData,h:VsmHandle,mip:u32,levelTexels:i32,markMask:u32,staticLayer:bool,tests:bool,}
fn vsmPatchSightOf(raw:VsmProjectionRecord,record:vec4u)->VsmPatchSight{
 var sight:VsmPatchSight;
 sight.mip=vsmRecordMip(record);
 sight.h=vsmHandleFromId(vsmRecordMap(record));
 sight.levelTexels=i32(VSM_LEVEL0_TEXELS>>sight.mip);
 sight.markMask=vsmRecordMarkMask(record);
 sight.staticLayer=vsmRecordStatic(record)!=0u;
 sight.tests=tu.occlusion!=${OCCLUSION_NONE}u;
 if(tu.occlusion==${OCCLUSION_MAIN}u){
  sight.pd=vsmUnpackProjection(raw,sight.h);
  sight.tests=vsmPrevViewHolds(sight.pd,sight.mip);
 }
 return sight;
}
fn vsmPatchHidden(placed:VsmPatchBox,rec:VsmPatchRecord,sight:VsmPatchSight)->bool{
 if(!sight.tests){return false;}
 if(tu.occlusion==${OCCLUSION_MAIN}u){
  let axes=placed.extent;
  let before=vsmPrevBoxInView(sight.pd,placed.center,vec3f(axes.x,0.0,0.0),vec3f(0.0,axes.y,0.0),vec3f(0.0,0.0,axes.z),rec.nearClip);
  return vsmHiddenBefore(sight.pd,before,sight.mip,sight.levelTexels,sight.staticLayer);
 }
 return vsmHiddenNow(sight.h,sight.mip,placed.cull,sight.levelTexels,vsmRectPixels(vec4i(0,0,sight.levelTexels,sight.levelTexels),placed.cull),sight.markMask,sight.staticLayer);
}`,
  ),
)
