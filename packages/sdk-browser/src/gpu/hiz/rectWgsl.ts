import { HIZ_KERNEL_TEXELS } from '../../hiz/counts.ts';

/**
 * Choice of the mip that answers for a screen rectangle ALREADY clipped to the viewport: GPU
 * mirror of `premierNiveau` then of the search `hizTestRect` did box by box on the CPU.
 *
 * This snippet is written once because three kernels depend on it — packing the opaque tested-
 * half bounds, the opaque main-pass cull and the transparent-cluster occlusion test — and two
 * writings of the same rule would eventually diverge. It reads no pyramid: only the level and
 * whether it exists come out, and a rectangle no mip covers is never rejected. It travels with
 * `hiddenByPyramid` below, the only reader outside this module.
 */
const HIZ_LEVEL_WGSL = `
/** Mirror of \`premierNiveau\` (../../hiz/occlusion.ts): lowest mip that can fit in the kernel. */
fn firstLevel(span:i32)->u32{
 if(span<${HIZ_KERNEL_TEXELS}){return 0u;}
 let level=31u-countLeadingZeros(u32(span))-${Math.log2(HIZ_KERNEL_TEXELS) - 1}u;
 return select(level,0u,level>31u);
}
/** The mip that covers the rectangle in fewer than sixteen texels, and whether one exists:
 *  \`(level, 1)\`, or \`(0, 0)\` when the pyramid holds none coarse enough. */
fn hizLevelFor(rect:vec4i,levels:u32)->vec2u{
 var l=firstLevel(max(rect.z-rect.x,rect.w-rect.y));
 loop{
  if(l>=levels){break;}
  if((rect.z>>l)-(rect.x>>l)<${HIZ_KERNEL_TEXELS}&&(rect.w>>l)-(rect.y>>l)<${HIZ_KERNEL_TEXELS}){
   return vec2u(l,1u);
  }
  l++;
 }
 return vec2u(0u,0u);
}
`;

/** The FARTHEST depth of a box's footprint in a pyramid mip — hence, in reverse-Z, the
 *  MINIMUM. An empty rectangle or one wider than the kernel returns `HIZ_NOTHING`, the value
 *  that never rejects. The host kernel declares `pyramid`, the only buffer this function reads. */
export const HIZ_FAR_WGSL = `
const HIZ_NOTHING:f32=-1.0e30;
fn pyramidFar(minX:i32,minY:i32,maxX:i32,maxY:i32,offset:u32,width:u32)->f32{
 let x0=minX;let y0=minY;let x1=maxX+1;let y1=maxY+1;
 if(x1<=x0||y1<=y0){return HIZ_NOTHING;}
 if(x1-x0>${HIZ_KERNEL_TEXELS}||y1-y0>${HIZ_KERNEL_TEXELS}){return HIZ_NOTHING;}
 var far=1.0e30;var hit=false;
 for(var y=y0;y<y1;y++){
  for(var x=x0;x<x1;x++){
   far=min(far,pyramid[offset+u32(y)*width+u32(x)]);
   hit=true;
  }
 }
 if(!hit){return HIZ_NOTHING;}
 return far;
}
`;

/**
 * Whether a pyramid hides a projected box: the unclipped rectangle is clipped to the viewport,
 * the mip that covers it is chosen, and the farthest depth read there is compared to the box's
 * nearest — reverse-Z, so hidden means SMALLER. A rectangle outside the viewport, or one no mip
 * covers, hides nothing. Reads the shared uniform (`PARTITION_UNI_WGSL`) and `pyramid`, which
 * the host kernel declares; the opaque main-pass cull and the transparent-cluster test are this
 * same function on their own inputs, so the two rules cannot diverge.
 */
export const HIZ_HIDDEN_WGSL = `${HIZ_LEVEL_WGSL}${HIZ_FAR_WGSL}
fn hiddenByPyramid(rect:vec4i,nearest:f32)->bool{
 let x0=max(rect.x,0);let y0=max(rect.y,0);
 let x1=min(rect.z,i32(uni.width)-1);let y1=min(rect.w,i32(uni.height)-1);
 if(x1<x0||y1<y0){return false;}
 let pick=hizLevelFor(vec4i(x0,y0,x1,y1),uni.levels);
 if(pick.y==0u){return false;}
 let l=pick.x;
 let far=pyramidFar(x0>>l,y0>>l,x1>>l,y1>>l,
  uni.levelOffset[l>>2u][l&3u],uni.levelWidth[l>>2u][l&3u]);
 return nearest<far;
}
`;
