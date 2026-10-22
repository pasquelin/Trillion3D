import { HIZ_KERNEL_TEXELS } from '../counts.ts'
import { floorLog2 } from '../../../../../math/src/scalar/integers.ts'
import { wgslBlock, wgslFn } from '../../../../../math/src/wgsl/decl.ts'
import { floorLog2 as floorLog2Decl } from '../../../../../math/src/wgsl/integer.ts'
import { HIZ_LEVELS_STRUCT_WGSL, HIZ_READ_WGSL } from './pyramidTexture.ts'

/** Mip `l`'s first index in the culling layer and its width, from the levels uniform the host binds
 *  as `hizLevels`: level 0's every layer is its own slice, a coarser level's culling bound lies
 *  `upper` before its nearest (`hizRoute`). The one reader of a mip's place, for every host that
 *  reads the culling layer — the transparent clusters, the cut's occlusion. */
export const HIZ_MIP_WGSL = wgslFn(
  'hizMip',
  [HIZ_LEVELS_STRUCT_WGSL],
  `fn hizMip(l:u32)->vec2u{
 let level=hizLevels.level[l];
 return vec2u(select(level.x-hizLevels.count.z,level.x,l==0u),level.y);
}`,
)

/**
 * The one pick of the pyramid rectangle of a screen rectangle: clipped to the viewport, the mip
 * that covers it in fewer than `HIZ_KERNEL_TEXELS` texels a side, and the coarse pre-test mip above
 * it. Every reader of a box's pyramid rectangle calls `hizRectPick` — the transparent-cluster test,
 * through `hiddenByPyramid` —, so their rectangles and levels cannot diverge. It reads no pyramid, only
 * the host's uniform `uni` (`width`, `height`) and the Hi-Z levels uniform the host binds as
 * `hizLevels` (`HIZ_LEVELS_STRUCT_WGSL`): the one mip table. A rectangle no mip covers is never
 * rejected.
 */
const HIZ_LEVEL_WGSL = wgslBlock(
  'HIZ_LEVEL_WGSL',
  [floorLog2Decl, HIZ_LEVELS_STRUCT_WGSL, HIZ_MIP_WGSL],
  `
/** Lowest mip where a span of \`span\` texels can fit in the kernel. */
fn firstLevel(span:i32)->u32{
 if(span<${HIZ_KERNEL_TEXELS}){return 0u;}
 let level=floorLog2(u32(span))-${floorLog2(HIZ_KERNEL_TEXELS) - 1}u;
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
struct HizRectPick{rect:vec4i,level:u32,coarse:u32,found:bool,}
/** Rectangle \`rect\` clipped to the viewport, the mip that covers it and its coarse pre-test's
 *  (\`hizLevelFor\`); not found when the clipped rectangle is empty or no mip covers it. */
fn hizRectPick(rect:vec4i)->HizRectPick{
 let r=vec4i(max(rect.x,0),max(rect.y,0),min(rect.z,i32(uni.width)-1),min(rect.w,i32(uni.height)-1));
 if(r.z<r.x||r.w<r.y){return HizRectPick(r,0u,0u,false);}
 let pick=hizLevelFor(r,hizLevels.count.x);
 return HizRectPick(r,pick.x,pick.z,pick.y!=0u);
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
 * the footprint itself decides. The rectangle is a found pick's (`hizRectPick`), in texels of its
 * mip: never empty, never wider than the kernel.
 * They read the pyramid's farthest layer through `hizCullFarthest`, the sampled read
 * (`HIZ_READ_WGSL`), over the host's `hizPyramid` binding.
 */
const HIZ_HIDES_WGSL = wgslBlock(
  'HIZ_HIDES_WGSL',
  [HIZ_READ_WGSL],
  `
fn texelsHide(x0:i32,y0:i32,x1:i32,y1:i32,offset:u32,width:u32,nearest:f32)->bool{
 for(var y=y0;y<=y1;y++){
  for(var x=x0;x<=x1;x++){
   if(!(nearest<hizCullFarthest(offset+u32(y)*width+u32(x)))){return false;}
  }
 }
 return true;
}
fn pyramidHides(minX:i32,minY:i32,maxX:i32,maxY:i32,offset:u32,width:u32,nearest:f32,
 coarseOffset:u32,coarseWidth:u32,shift:u32)->bool{
 if(shift>0u&&texelsHide(minX>>shift,minY>>shift,maxX>>shift,maxY>>shift,coarseOffset,coarseWidth,nearest)){return true;}
 return texelsHide(minX,minY,maxX,maxY,offset,width,nearest);
}
`,
)

/**
 * Whether a pyramid hides a projected box: the unclipped rectangle is clipped to the viewport,
 * the mip that covers it is chosen, and the farthest depth read there is compared to the box's
 * nearest (`pyramidHides`, after its coarse pre-test) — reverse-Z, so hidden means SMALLER. A
 * rectangle outside the viewport, or one no mip covers, hides nothing. Reads the host's uniform
 * `uni` (`PROJECTION_UNI_WGSL`), the levels uniform `hizLevels` and the sampled pyramid
 * `hizPyramid`, which the host kernel declares (`HIZ_READ_WGSL`): the transparent-cluster test
 * (`../../../gpu/core/transparentOcclusionWgsl.ts`).
 */
export const HIZ_HIDDEN_WGSL = wgslBlock(
  'HIZ_HIDDEN_WGSL',
  [HIZ_LEVEL_WGSL, HIZ_HIDES_WGSL],
  `fn hiddenByPyramid(rect:vec4i,nearest:f32)->bool{
 let p=hizRectPick(rect);
 if(!p.found){return false;}
 let l=p.level;let fine=hizMip(l);let coarse=hizMip(p.coarse);
 return pyramidHides(p.rect.x>>l,p.rect.y>>l,p.rect.z>>l,p.rect.w>>l,fine.x,fine.y,nearest,
  coarse.x,coarse.y,p.coarse-l);
}
`,
)
