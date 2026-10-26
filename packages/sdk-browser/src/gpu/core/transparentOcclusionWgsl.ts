import { BOX_PROJECT_WGSL, CORNER_VALUES, PROJECTION_UNI_WGSL } from './boxProjectWgsl.ts'
import { HIZ_CLIP_RECT_WGSL, HIZ_HIDDEN_WGSL } from '../../visibility/hiz/gpu/rectWgsl.ts'
import { HIZ_REFERENCE_HIDDEN_WGSL } from '../../visibility/hiz/gpu/footprintWgsl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../dispatch/grid.ts'
import { TRANSPARENT_DEPTH_LAYER } from '../../../../sdk-core/src/lod/depthLayer.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { bitIsSet, bitWord } from '../../../../math/src/wgsl/integer.ts'
import { wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { HIZ_KERNEL_TEXELS } from '../../visibility/hiz/counts.ts'
import { HIZ_OPAQUE_LAYER } from '../../visibility/hiz/gpu/pyramidTexture.ts'

/** The override that makes the pyramid walk the reference's (`transparentOcclusionShader`). */
export const TRANSPARENT_REFERENCE_TEST = 'TRANSPARENT_REFERENCE_TEST'

/** The box too small for the pyramid's first level to be exact: the culling layer starts at half resolution, so
 *  a footprint under `HIZ_KERNEL_TEXELS` pixels a side reads the opaque depth itself (`hizDepth`, level 0, the
 *  binding the owner passes), texel by texel, and hides the box when every texel is behind its nearest. A larger
 *  footprint walks the pyramid (`hiddenByPyramid`). */
const HIDDEN_BY_DEPTH_WGSL = wgslFn(
  'hiddenByDepth',
  [HIZ_HIDDEN_WGSL, HIZ_CLIP_RECT_WGSL],
  `fn hiddenByDepth(rect:vec4i,nearest:f32)->bool{
 let r=hizClipRect(rect);
 if(r.z<r.x||r.w<r.y){return false;}
 if(r.z-r.x>=${HIZ_KERNEL_TEXELS}||r.w-r.y>=${HIZ_KERNEL_TEXELS}){return hiddenByPyramid(rect,nearest);}
 for(var y=r.y;y<=r.w;y++){
  for(var x=r.x;x<=r.z;x++){
   if(!(nearest<textureLoad(hizDepth,vec2i(x,y),${HIZ_OPAQUE_LAYER},0).r)){return false;}
  }
 }
 return true;
}`,
)

/**
 * Occlusion test of transparent clusters, one table entry per thread.
 *
 * The conservative projection (`projectBox`) under the frame's projection uniform — the buffer the
 * test wrote for this frame (`transparentOcclusion.ts`) —, the rectangle pick (`hizRectPick`) and the
 * pyramid walk (`pyramidHides`), on the farthest layer of the Hi-Z pyramid the frame just built:
 *
 *  - the coplanar-layer bias is that of the HIGHEST layer the frame names, for every entry, and at
 *    least the layer the transparent passes draw on (`TRANSPARENT_DEPTH_LAYER`). A cluster does
 *    not announce its own here, and the bias only BRINGS the depth bound closer: taking it
 *    maximal rejects less, never more;
 *  - a box that clips the near plane, an empty off-screen rectangle, a footprint no mip covers and an entry never culled (its bit in
 *    `unculled`, `neverCulled`) reject nothing at all;
 *  - the verdict is written for EVERY entry every frame, never accumulated: a frame that does
 *    not encode this kernel leaves no remainder of it (the caller then clears the buffer).
 *
 *  - a footprint under sixteen pixels a side is read at full resolution in the opaque depth (`hiddenByDepth`), the
 *    pyramid's first level being half resolution;
 *  - the pyramid walk is one of two (the override `TRANSPARENT_REFERENCE_TEST`, the setting
 *    `hizTransparentTest`): the finer level's, as above, or the reference's — the lowest level that
 *    holds the rectangle in four texels a side (`hiddenByReferencePyramid`). The finer level's
 *    minimum is never less than the coarser one's over the same rectangle, so it rejects at least
 *    what the reference's rejects; neither rejects a cluster in front of the depth.
 *
 * The verdict only drops clusters ENTIRELY behind already-drawn opaque. It reorders nothing:
 * the compact keeps its table order, whose rejected entries leave as those the cut did not
 * select leave.
 */
export function transparentOcclusionShader() {
  return wgslProgram(
    `override ${TRANSPARENT_REFERENCE_TEST}:bool=false;
@group(0) @binding(0) var<storage, read> corners:array<f32>;
@group(0) @binding(1) var hizPyramid:texture_2d_array<u32>;
@group(0) @binding(2) var<storage, read_write> occluded:array<u32>;
@group(0) @binding(3) var<uniform> uni:Uni;
@group(0) @binding(4) var<storage, read> unculled:array<u32>;
@group(0) @binding(5) var<uniform> hizLevels:HizLevels;
@group(0) @binding(6) var hizDepth:texture_2d_array<f32>;
@compute @workgroup_size(WORKGROUP_THREADS)
fn testTransparentClusters(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let i=flatIndex(id,n,WORKGROUP_THREADS);if(i>=arrayLength(&corners)/${CORNER_VALUES}u){return;}
 let box=projectBox(i,max(uni.layerTop,${TRANSPARENT_DEPTH_LAYER}u));
 // The rectangle clipped, its mip picked and the pyramid walked (\`hiddenByPyramid\`), the layer
 // bias the highest the frame names, at least the transparent passes' own.
 let open=bitIsSet(unculled[bitWord(i)],i);
 var hidden:bool;
 if(${TRANSPARENT_REFERENCE_TEST}){hidden=hiddenByReferencePyramid(box.rect,box.nearest);}else{hidden=hiddenByDepth(box.rect,box.nearest);}
 let reject=!open&&box.clips==0u&&hidden;
 occluded[i]=select(0u,1u,reject);
}
`,
    [
      PROJECTION_UNI_WGSL,
      BOX_PROJECT_WGSL,
      HIDDEN_BY_DEPTH_WGSL,
      HIZ_REFERENCE_HIDDEN_WGSL,
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
      bitWord,
      bitIsSet,
    ],
  )
}
