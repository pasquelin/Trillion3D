import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { lowBits } from '../../../math/src/wgsl/integer.ts'
import { VSM_BOX_CULL_WGSL } from './boxCullWgsl.ts'
import { VSM_CONSTANTS_WGSL } from './constants.ts'
import { VSM_COVER_GATHER_WGSL, VSM_HANDLE_WGSL, VSM_PAGE_ADDRESS_WGSL } from './pageTableWgsl.ts'

/** The page-overlap and static-caching pieces the command cull reads (`renderCullWgsl.ts`): its
 *  host declares the stale rects it clips to (`vsmStaleRects`, `VSM_RENDER_CULL_SPECS`). */
export const VSM_RENDER_OVERLAP_WGSL = wgslBlock(
  'VSM_RENDER_OVERLAP_WGSL',
  [
    VSM_CONSTANTS_WGSL,
    VSM_HANDLE_WGSL,
    VSM_PAGE_ADDRESS_WGSL,
    VSM_COVER_GATHER_WGSL,
    VSM_BOX_CULL_WGSL,
    lowBits,
  ],
  `
/** A mask of \`runWidth\` bits at \`runStart\`. */
fn vsmBitRun(runWidth:u32,runStart:u32)->u32{
 return lowBits(runWidth&31u)<<(runStart&31u);
}
/** Whether a rect of the 8x8 receiver cover intersects the 2x2 quadrant masks: x (-,+), y (+,+), z (+,-), w (-,-). */
fn vsmMaskRectHits(mask2x2:vec4u,mn:vec2u,mx:vec2u)->bool{
 let xBits=mx.x-mn.x+1u;
 let xRun=vsmBitRun(xBits,mn.x);
 let xLow=xRun&0xFu;
 let xHigh=xRun>>4u;
 let yLast4=mx.y<<2u;
 let yFirst4=mn.y<<2u;
 let yBits=yLast4-yFirst4+1u;
 let yRun=vsmBitRun(yBits,yFirst4);
 let rowsLow=0x1111u&yRun;
 let rowsHigh=0x1111u&(yRun>>16u);
 let cellBits=vec4u(xLow*rowsHigh,xHigh*rowsHigh,xHigh*rowsLow,xLow*rowsLow);
 return (mask2x2.x&cellBits.x)!=0u||(mask2x2.y&cellBits.y)!=0u||(mask2x2.z&cellBits.z)!=0u||(mask2x2.w&cellBits.w)!=0u;
}
/** Whether any valid page overlaps a pixel rect clamped to the valid page region, and, with the
 *  receiver cover, a receiver of the rect. */
fn vsmTouchesMappedPixels(h:VsmHandle,mipLevel:u32,pixels:vec4i,askedMarks:u32,fineCaster:bool,useCover:bool)->bool{
 if(any(pixels.zw<pixels.xy)){return false;}
 let pagesRect=vec4u(pixels)>>vec4u(VSM_LOG2_PAGE);
 if(!vsmTouchesMappedPage(h,mipLevel,pagesRect,askedMarks,fineCaster)){return false;}
 if(!useCover){return true;}
 let entryCell=vsmTableEntryOf(h,mipLevel,pagesRect.xy);
 let halfPageRect=vec4u(pixels)>>vec4u(VSM_LOG2_PAGE-1u);
 let coverLevel=u32(vsmLevelHoldingRect(vec4i(halfPageRect),2));
 let coverCell=entryCell.tableXY*2u+(halfPageRect.xy&vec2u(1u));
 let offsetMip=halfPageRect.xy>>vec2u(coverLevel);
 let offset=offsetMip<<vec2u(VSM_LOG2_COVER_CELLS+coverLevel-1u);
 let cellRect=vec4u(pixels)>>vec4u(VSM_LOG2_PAGE-VSM_LOG2_COVER_CELLS);
 let subRect=cellRect-offset.xyxy;
 let subRectAtLevel=subRect>>vec4u(coverLevel);
 let cover8x8=vsmGatherCover(coverCell,coverLevel);
 return vsmMaskRectHits(cover8x8,subRectAtLevel.xy,subRectAtLevel.zw);
}
/** Clips a pixel rect to the uncached page rect bounds of a map's mip. */
fn vsmClipToStaleRect(pixels:vec4i,h:VsmHandle,mipLevel:u32)->vec4i{
 let staleRectPages=vsmStaleRects[h.id*VSM_MIPS+mipLevel];
 let bounds=vec4i(vec4u(staleRectPages.xy<<vec2u(VSM_LOG2_PAGE),(staleRectPages.zw<<vec2u(VSM_LOG2_PAGE))+vec2u(VSM_PAGE_TEXELS-1u)));
 return vec4i(max(pixels.xy,bounds.xy),min(pixels.zw,bounds.zw));
}
/** The raster marks a drawn page takes: its static or dynamic drawn bit, and its stale bit too where the caster deforms. */
fn vsmRasterMarkBits(staticLayer:bool,staleAfter:bool)->u32{
 var flags=select(1u,2u,staticLayer);
 if(staleAfter){flags|=select(4u,8u,staticLayer);}
 return flags;
}
/** The shifted-to-clip matrix of a VSM view, from the stored shiftedToShadowUV
 *  (the clip-to-UV scale and bias inverted: x = 2u − w, y = w − 2v, z and w kept). */
fn vsmShiftedToClip(uv:mat4x4f)->mat4x4f{
 var m:mat4x4f;
 for(var k=0u;k<4u;k++){
  let c=uv[k];
  m[k]=vec4f(2.0*c.x-c.w,c.w-2.0*c.y,c.z,c.w);
 }
 return m;
}
`,
)
