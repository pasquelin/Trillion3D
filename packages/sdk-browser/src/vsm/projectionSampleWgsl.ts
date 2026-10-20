/**
 * THE PAGE SAMPLING OF THE PROJECTION SIDE (`projectionDataWgsl.ts`): a local map's read through its
 * coarser mips, a clipmap level's through its coarser levels, the texel a sample reads and the depth
 * it takes to the sampled level. Through the page lookup (`VSM_PAGE_LOOKUP_WGSL`) and `pool`, the
 * host's `vsmPoolLoad(texel, slice)`: a pass's (`vsmPoolLoadOf`, `resources.ts`) or a consumer's.
 */
import { VSM_CONSTANTS_WGSL } from './constants.ts'
import {
  VSM_HANDLE_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_PAGE_LOOKUP_WGSL,
  VSM_TABLE_ORIGIN_WGSL,
} from './pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts'
import { type WgslDecl, wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { pow2FromExponent } from '../../../math/src/wgsl/integer.ts'

/**
 * Clipmap levels are computed in centimetres (`VSM_CM_PER_UNIT`): the
 * level of a distance d is 0.5·log2(d²) with d in cm.
 */
export const vsmProjectionSampleWgsl = (pool: WgslDecl) =>
  wgslBlock(
    'VSM_PROJECTION_SAMPLE_WGSL',
    [
      pool,
      VSM_CONSTANTS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_PAGE_LOOKUP_WGSL,
      VSM_TABLE_ORIGIN_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      pow2FromExponent,
    ],
    `
/** The biased level of a distance, without a depth-of-field bias. A clipmap's levels all carry its
 *  one resolution bias (\`vsmClipmapProjectionData\`, \`clipmapBias.test.ts\`), the base level's among them,
 *  which the base record already holds. */
fn vsmSampledLevel(base:VsmProjectionData,distSqToOrigin:f32)->f32{
 return vsmLevelOfDistanceSq(distSqToOrigin)+base.levelBias;
}
struct VsmMapRead{
 depth:f32,
 mipLevel:u32,
 handle:VsmHandle,
 valid:bool,
 mapTexelXY:vec2u,
 mapTexelPos:vec2f,
 poolTexel:vec2u,
}
fn vsmEmptyRead()->VsmMapRead{return VsmMapRead(0.0,0u,vsmHandleInvalid(),false,vec2u(0u),vec2f(0.0),vec2u(0u));}
/** Slice 0 holds dynamic merged with static after the merge of the static pages. */
fn vsmPoolDepth(poolTexel:vec2u)->f32{return bitcast<f32>(vsmPoolLoad(poolTexel,0u));}
/** Local lights: follows the coarser-level count from finestMip. */
fn vsmReadMap(h:VsmHandle,mapUvAt:vec2f,finestMip:u32)->VsmMapRead{
 return vsmReadAt(h,vsmLocalPageAt(h,mapUvAt,finestMip));
}
/** \`vsmReadMap\` of the page \`page\` translated. */
fn vsmReadAt(h:VsmHandle,page:VsmLocalPage)->VsmMapRead{
 var r=vsmEmptyRead();
 if(page.valid){
  r.valid=true;
  r.mipLevel=page.coarserLevels;
  r.handle=h;
  r.mapTexelXY=page.mapTexelXY;
  r.mapTexelPos=page.mapTexelPos;
  r.poolTexel=page.poolTexel;
  r.depth=vsmPoolDepth(r.poolTexel);
 }
 return r;
}
struct VsmLevelToLevel{scale:f32,bias:vec3f,depthInverse:f32,}
/** The UV/depth transform from level h to level h + levelOffset. */
fn vsmLevelToLevelOf(h:VsmHandle,levelOffset:i32)->VsmLevelToLevel{
 // The two levels' fields it reads, not their whole records: a fallback sample of a ray reads them.
 let a=h.id;
 let b=vsmHandleOffset(h,levelOffset).id;
 let offsetA=vec2f(vsmProjectionData[a].cornerSteps);
 let offsetB=vec2f(vsmProjectionData[b].cornerSteps);
 var r:VsmLevelToLevel;
 r.scale=select(pow2FromExponent(-levelOffset),1.0/pow2FromExponent(levelOffset),levelOffset>=0);
 // The scale's inverse, as exact as it: a depth taken to this level multiplies by it, to the bit
 // what dividing by the scale gives (\`clipmapDepth.test.ts\`).
 r.depthInverse=select(1.0/pow2FromExponent(-levelOffset),pow2FromExponent(levelOffset),levelOffset>=0);
 r.bias=vec3f(0.25*(offsetB-r.scale*offsetA),0.0);
 let offsetZA=vsmProjectionData[a].lightViewToClip[3][2];
 let offsetZB=vsmProjectionData[b].lightViewToClip[3][2];
 r.bias.z=offsetZB-r.scale*offsetZA;
 return r;
}
/** The integer page transform to a coarser level (levelOffset > 0). */
fn vsmCoarserLevelPage(levelZeroPage:vec2u,h:VsmHandle,levelOffset:u32)->vec2u{
 let quarterPages=i32(VSM_LEVEL0_PAGES>>2u);
 let firstShiftPages=quarterPages*vsmProjectionData[h.id].cornerSteps;
 let levelShiftPages=quarterPages*vsmProjectionData[vsmHandleOffset(h,i32(levelOffset)).id].cornerSteps;
 // An unsigned page less a signed offset wraps (unsigned arithmetic), and >> is a logical shift.
 return (levelZeroPage-bitcast<vec2u>(firstShiftPages)+bitcast<vec2u>(levelShiftPages<<vec2u(levelOffset)))>>vec2u(levelOffset);
}
/** The level-0 page of a UV of the level. */
fn vsmClipmapBasePage(mapUvAt:vec2f)->vec2u{return vec2u(mapUvAt*f32(VSM_LEVEL0_PAGES));}
/** The page-table reads for the level-0 page \`levelZeroPage\` of level h: its entry's word, and
 *  that of the page its coarser-level count falls back to (the same word without one); and, read
 *  once for every texel of the page, where that count falls back: the coarser level, the first
 *  texel of its page and the UV/depth transform to it (\`vsmLevelToLevelOf\`). */
struct VsmClipmapPage{entry:u32,levelEntry:u32,levelHandle:VsmHandle,levelTexelMin:vec2u,toLevel:VsmLevelToLevel,}
fn vsmClipmapPage(h:VsmHandle,levelZeroPage:vec2u)->VsmClipmapPage{
 var p:VsmClipmapPage;
 p.entry=vsmTableWord(vsmTableEntryOf(h,0u,levelZeroPage));
 p.levelEntry=p.entry;
 p.levelHandle=h;
 let e=vsmUnpackTableEntry(p.entry);
 if(e.anyLevelMapped&&e.coarserLevels>0u){
  let levelGap=e.coarserLevels;
  p.levelHandle=vsmHandleOffset(h,i32(levelGap));
  let vPage=vsmCoarserLevelPage(levelZeroPage,h,levelGap);
  p.levelTexelMin=vPage*VSM_PAGE_TEXELS;
  p.toLevel=vsmLevelToLevelOf(h,i32(levelGap));
  p.levelEntry=vsmTableWord(vsmTableEntryOf(p.levelHandle,0u,vPage));
 }
 return p;
}
/** The texel \`vsmReadClipmapPage\` reads at a UV of the page \`page\` of level h (\`vsmClipmapPage\`):
 *  where its coarser-level count falls back to a coarser level, that level's texel, clamped to its page, and
 *  the bias and inverse scale its raw depth takes to h's (\`vsmClipmapTexelDepth\`). \`valid\`: the
 *  texel is mapped. Where no level maps the page, the addresses are 0, as \`vsmEmptyRead\`'s. */
struct VsmClipmapTexel{
 valid:bool,
 levelHandle:VsmHandle,
 mapTexelXY:vec2u,
 mapTexelPos:vec2f,
 poolTexel:vec2u,
 depthLevelBias:f32,
 depthLevelInverse:f32,
}
fn vsmClipmapTexel(h:VsmHandle,page:VsmClipmapPage,mapUvAt:vec2f)->VsmClipmapTexel{
 var r:VsmClipmapTexel;
 // On the sample's own level (raw − 0)·1 is the raw depth (\`clipmapDepth.test.ts\`).
 r.depthLevelInverse=1.0;
 var e=vsmUnpackTableEntry(page.entry);
 if(e.anyLevelMapped){
  let levelGap=e.coarserLevels;
  r.levelHandle=page.levelHandle;
  r.mapTexelPos=mapUvAt*f32(vsmTexelsAtLevel(0u));
  r.mapTexelXY=vec2u(r.mapTexelPos);
  if(levelGap>0u){
   let t=page.toLevel;
   let levelUv=mapUvAt*t.scale+t.bias.xy;
   r.depthLevelInverse=t.depthInverse;
   r.depthLevelBias=t.bias.z;
   r.mapTexelPos=levelUv*f32(vsmTexelsAtLevel(0u));
   r.mapTexelXY=clamp(vec2u(r.mapTexelPos),page.levelTexelMin,page.levelTexelMin+vec2u(VSM_PAGE_TEXELS-1u));
   e=vsmUnpackTableEntry(page.levelEntry);
  }
  if(e.thisLevelMapped){
   r.poolTexel=e.physicalAddress*VSM_PAGE_TEXELS+(r.mapTexelXY&vec2u(VSM_PAGE_TEXEL_MASK));
   r.valid=true;
  }
 }
 return r;
}
/** A raw pool depth of \`t\`'s level as the sampled level reads it: (raw − bias)·inverse, which no
 *  greater raw depth makes smaller (rounding is monotonic, the inverse positive). */
fn vsmClipmapTexelDepth(t:VsmClipmapTexel,raw:f32)->f32{return (raw-t.depthLevelBias)*t.depthLevelInverse;}
/** The clipmap's sample at a UV of level h's page \`page\` read (\`vsmClipmapPage\`): its level-0
 *  entry, then its coarser-level count to a coarser level, the depth taken back to h's. */
fn vsmReadClipmapPage(h:VsmHandle,page:VsmClipmapPage,mapUvAt:vec2f)->VsmMapRead{
 let t=vsmClipmapTexel(h,page,mapUvAt);
 var r=vsmEmptyRead();
 r.mapTexelPos=t.mapTexelPos;
 r.mapTexelXY=t.mapTexelXY;
 r.poolTexel=t.poolTexel;
 if(t.valid){
  r.depth=vsmClipmapTexelDepth(t,vsmPoolDepth(t.poolTexel));
  r.mipLevel=0u;
  r.handle=t.levelHandle;
  r.valid=true;
 }
 return r;
}
`,
  )
