import { HIZ_KERNEL_TEXELS } from '../../hiz/counts.ts'
import { floorLog2 } from '../../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * Choice of the mip that answers for a screen rectangle ALREADY clipped to the viewport: GPU
 * mirror of `firstLevel` then of the search `hizTestRect` did box by box on the CPU.
 *
 * This snippet is written once because three kernels depend on it — packing the opaque tested-
 * half bounds, the opaque main-pass cull and the transparent-cluster occlusion test — and two
 * writings of the same rule would eventually diverge. It reads no pyramid: only the level and
 * whether it exists come out, and a rectangle no mip covers is never rejected. It travels with
 * `hiddenByPyramid` below, the only reader outside this module.
 */
const HIZ_LEVEL_WGSL = wgslBlock(
  'HIZ_LEVEL_WGSL',
  [],
  `
/** Mirror of \`premierNiveau\` (../../hiz/occlusion.ts): lowest mip that can fit in the kernel. */
fn firstLevel(span:i32)->u32{
 if(span<${HIZ_KERNEL_TEXELS}){return 0u;}
 let level=31u-countLeadingZeros(u32(span))-${floorLog2(HIZ_KERNEL_TEXELS) - 1}u;
 return select(level,0u,level>31u);
}
/** Whether the level-0 rectangle spans fewer than \`n\` texel steps per side in mip \`l\`. */
fn fitsAt(rect:vec4i,l:u32,n:i32)->bool{return (rect.z>>l)-(rect.x>>l)<n&&(rect.w>>l)-(rect.y>>l)<n;}
/** Coarse pre-test mip of \`pyramidHides\`: the first mip from \`l\` up where the level-0 rectangle
 *  spans at most two texels per side, capped at the last mip; \`l\` itself when it already does. */
fn hizCoarseLevel(rect:vec4i,l:u32,levels:u32)->u32{
 var c=l;
 loop{
  if(c+1u>=levels||fitsAt(rect,c,2)){break;}
  c++;
 }
 return c;
}
/** The mip that covers the rectangle in fewer than sixteen texels, whether one exists, and the
 *  coarse pre-test mip above it (\`hizCoarseLevel\`): \`(level, 1, coarse)\`, or \`(0, 0, 0)\` when
 *  the pyramid holds none coarse enough. */
fn hizLevelFor(rect:vec4i,levels:u32)->vec3u{
 var l=firstLevel(max(rect.z-rect.x,rect.w-rect.y));
 loop{
  if(l>=levels){break;}
  if(fitsAt(rect,l,${HIZ_KERNEL_TEXELS})){return vec3u(l,1u,hizCoarseLevel(rect,l,levels));}
  l++;
 }
 return vec3u(0u,0u,0u);
}
`,
)

/**
 * Whether the farthest depth of a box's footprint in a pyramid mip — in reverse-Z, the MINIMUM —
 * hides the box's nearest: `nearest < min(texels)`, verdict for verdict, in fewer reads.
 *
 * `texelsHide` asks every texel of an INCLUSIVE rectangle and stops at the first that does not
 * hide: the minimum can only go down from there, so no later texel brings the verdict back.
 *
 * `pyramidHides` first reads the rectangle `shift` mips up (`hizCoarseLevel`), where it spans at
 * most 2×2 texels: a coarse texel is the minimum of every finer texel under it, so when the coarse
 * texels hide the box, every texel of the footprint does — rejected in at most four reads. Else
 * the footprint itself decides. An empty rectangle, or one wider than the kernel, never hides.
 * The host kernel declares `pyramid`, the only buffer these functions read.
 */
export const HIZ_HIDES_WGSL = wgslBlock(
  'HIZ_HIDES_WGSL',
  [],
  `
fn texelsHide(x0:i32,y0:i32,x1:i32,y1:i32,offset:u32,width:u32,nearest:f32)->bool{
 for(var y=y0;y<=y1;y++){
  for(var x=x0;x<=x1;x++){
   if(!(nearest<pyramid[offset+u32(y)*width+u32(x)])){return false;}
  }
 }
 return true;
}
fn pyramidHides(minX:i32,minY:i32,maxX:i32,maxY:i32,offset:u32,width:u32,nearest:f32,
 coarseOffset:u32,coarseWidth:u32,shift:u32)->bool{
 if(maxX<minX||maxY<minY){return false;}
 if(maxX+1-minX>${HIZ_KERNEL_TEXELS}||maxY+1-minY>${HIZ_KERNEL_TEXELS}){return false;}
 if(shift>0u&&texelsHide(minX>>shift,minY>>shift,maxX>>shift,maxY>>shift,coarseOffset,coarseWidth,nearest)){return true;}
 return texelsHide(minX,minY,maxX,maxY,offset,width,nearest);
}
`,
)

/**
 * Whether a pyramid hides a projected box: the unclipped rectangle is clipped to the viewport,
 * the mip that covers it is chosen, and the farthest depth read there is compared to the box's
 * nearest (`pyramidHides`, after its coarse pre-test) — reverse-Z, so hidden means SMALLER. A
 * rectangle outside the viewport, or one no mip covers, hides nothing. Reads the shared uniform
 * (`PARTITION_UNI_WGSL`) and `pyramid`, which the host kernel declares; the opaque main-pass cull
 * and the transparent-cluster test are this same function on their own inputs, so the two rules
 * cannot diverge.
 */
export const HIZ_HIDDEN_WGSL = wgslBlock(
  'HIZ_HIDDEN_WGSL',
  [HIZ_LEVEL_WGSL, HIZ_HIDES_WGSL],
  `fn hiddenByPyramid(rect:vec4i,nearest:f32)->bool{
 let x0=max(rect.x,0);let y0=max(rect.y,0);
 let x1=min(rect.z,i32(uni.width)-1);let y1=min(rect.w,i32(uni.height)-1);
 if(x1<x0||y1<y0){return false;}
 let pick=hizLevelFor(vec4i(x0,y0,x1,y1),uni.levels);
 if(pick.y==0u){return false;}
 let l=pick.x;let c=pick.z;
 return pyramidHides(x0>>l,y0>>l,x1>>l,y1>>l,
  uni.levelOffset[l>>2u][l&3u],uni.levelWidth[l>>2u][l&3u],nearest,
  uni.levelOffset[c>>2u][c&3u],uni.levelWidth[c>>2u][c&3u],c-l);
}
`,
)
