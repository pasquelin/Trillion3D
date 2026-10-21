import { BOX_PROJECT_WGSL, CORNER_VALUES, PROJECTION_UNI_WGSL } from './boxProjectWgsl.ts'
import { HIZ_HIDDEN_WGSL } from '../../visibility/hiz/gpu/rectWgsl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../dispatch/grid.ts'
import { TRANSPARENT_DEPTH_LAYER } from '../../../../sdk-core/src/lod/depthLayer.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { bitIsSet, bitWord } from '../../../../math/src/wgsl/integer.ts'

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
 * The verdict only drops clusters ENTIRELY behind already-drawn opaque. It reorders nothing:
 * the compact keeps its table order, whose rejected entries leave as those the cut did not
 * select leave.
 */
export function transparentOcclusionShader() {
  return wgslProgram(
    `@group(0) @binding(0) var<storage, read> corners:array<f32>;
@group(0) @binding(1) var hizPyramid:texture_2d_array<u32>;
@group(0) @binding(2) var<storage, read_write> occluded:array<u32>;
@group(0) @binding(3) var<uniform> uni:Uni;
@group(0) @binding(4) var<storage, read> unculled:array<u32>;
@group(0) @binding(5) var<uniform> hizLevels:HizLevels;
@compute @workgroup_size(WORKGROUP_THREADS)
fn testTransparentClusters(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let i=flatIndex(id,n,WORKGROUP_THREADS);if(i>=arrayLength(&corners)/${CORNER_VALUES}u){return;}
 let box=projectBox(i,max(uni.layerTop,${TRANSPARENT_DEPTH_LAYER}u));
 // The rectangle clipped, its mip picked and the pyramid walked (\`hiddenByPyramid\`), the layer
 // bias the highest the frame names, at least the transparent passes' own.
 let open=bitIsSet(unculled[bitWord(i)],i);
 let reject=!open&&box.clips==0u&&hiddenByPyramid(box.rect,box.nearest);
 occluded[i]=select(0u,1u,reject);
}
`,
    [
      PROJECTION_UNI_WGSL,
      BOX_PROJECT_WGSL,
      HIZ_HIDDEN_WGSL,
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
      bitWord,
      bitIsSet,
    ],
  )
}
