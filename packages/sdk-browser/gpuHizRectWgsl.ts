import { HIZ_KERNEL_TEXELS } from './hizCounts.ts';

/**
 * Choice of the mip that answers for a screen rectangle ALREADY clipped to the viewport: GPU
 * mirror of `premierNiveau` then of the search `hizTestRect` did box by box on the CPU.
 *
 * This snippet is written once because two kernels depend on it — packing the opaque tested-half
 * bounds and the transparent-cluster occlusion test — and two writings of the same rule would
 * eventually diverge. Neither reads the pyramid here: only the level and whether it exists come
 * out, and a rectangle no mip covers is never rejected.
 */
export const HIZ_LEVEL_WGSL = `
/** Mirror of \`premierNiveau\` (hizOcclusion.ts): lowest mip that can fit in the kernel. */
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
