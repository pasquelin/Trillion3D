import { BOX_PROJECT_WGSL, PARTITION_UNI_WGSL } from './gpuBoxProjectWgsl.ts';
import { HIZ_FAR_WGSL, HIZ_LEVEL_WGSL } from './gpuHizRectWgsl.ts';
import { PARTITION_WORKGROUP } from './gpuPartitionContract.ts';

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
${HIZ_LEVEL_WGSL}
${HIZ_FAR_WGSL}
@compute @workgroup_size(${PARTITION_WORKGROUP})
fn testTransparentClusters(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=${Math.max(1, entryCount)}u){return;}
 var reject=0u;
 let box=projectBox(i,uni.layerTop);
 if(box.clips==0u&&uni.levels>0u){
  // Rectangle clipped to the viewport, expressed in texels of the mip that covers it: exact
  // mirror of packing the opaque tested-half bounds (\`gpuPartitionClassifyWgsl.ts\`).
  let x0=max(box.rect.x,0);let y0=max(box.rect.y,0);
  let x1=min(box.rect.z,i32(uni.width)-1);let y1=min(box.rect.w,i32(uni.height)-1);
  if(x1>=x0&&y1>=y0){
   let pick=hizLevelFor(vec4i(x0,y0,x1,y1),uni.levels);
   if(pick.y!=0u){
    let l=pick.x;
    let far=pyramidFar(x0>>l,y0>>l,x1>>l,y1>>l,
     uni.levelOffset[l>>2u][l&3u],uni.levelWidth[l>>2u][l&3u]);
    reject=select(0u,1u,box.nearest<far);
   }
  }
 }
 occluded[i]=reject;
}
`;
}
