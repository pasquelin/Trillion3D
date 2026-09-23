import { BOX_PROJECT_WGSL, PARTITION_UNI_WGSL } from './boxProjectWgsl.ts';
import { HIZ_HIDDEN_WGSL } from '../hiz/rectWgsl.ts';
import { PARTITION_WORKGROUP } from '../partition/contract.ts';

/**
 * Occlusion test of transparent clusters, one table entry per thread.
 *
 * This is the SAME rule as the opaques', to the letter: the same conservative projection
 * (`projectBox`), the same uniform — the buffer the partition wrote for this frame —, the same
 * mip choice (`hizLevelFor`) and the same pyramid walk (`pyramidFar`), on the Hi-Z pyramid the
 * frame just built. Nothing is proper to transparents except what fidelity requires:
 *
 *  - the coplanar-layer bias is that of the HIGHEST layer the frame names, for every entry. A
 *    cluster does not announce its own here, and the bias only BRINGS the depth bound closer:
 *    taking it maximal rejects less, never more;
 *  - a box that clips the near plane, an empty off-screen rectangle, a frame without a pyramid
 *    (`uni.levels == 0`) and a footprint no mip covers reject nothing at all;
 *  - the verdict is written for EVERY entry every frame, never accumulated: a frame that does
 *    not encode this kernel leaves no remainder of it (the caller then clears the buffer).
 *
 * The verdict only drops clusters ENTIRELY behind already-drawn opaque. It reorders nothing:
 * the compact keeps its table order, whose rejected entries leave as those the cut did not
 * select leave.
 */
export function transparentOcclusionShader(entryCount: number) {
  return `${PARTITION_UNI_WGSL}@group(0) @binding(0) var<storage, read> corners:array<f32>;
@group(0) @binding(1) var<storage, read> pyramid:array<f32>;
@group(0) @binding(2) var<storage, read_write> occluded:array<u32>;
@group(0) @binding(3) var<uniform> uni:Uni;
${BOX_PROJECT_WGSL}
${HIZ_HIDDEN_WGSL}@compute @workgroup_size(${PARTITION_WORKGROUP})
fn testTransparentClusters(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=${Math.max(1, entryCount)}u){return;}
 let box=projectBox(i,uni.layerTop);
 // Same rectangle clipping, same mip, same pyramid walk as the opaque main-pass cull
 // (\`hiddenByPyramid\`); only the layer bias is that of the highest layer the frame names.
 let reject=box.clips==0u&&uni.levels>0u&&hiddenByPyramid(box.rect,box.nearest);
 occluded[i]=select(0u,1u,reject);
}
`;
}
