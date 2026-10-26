import { VSM_COVER_GATHER_WGSL } from '../pageGatherWgsl.ts'
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { lowBits } from '../../../../../../math/src/wgsl/integer.ts'
import { VSM_BOX_CULL_WGSL } from '../invalidation/boxCullWgsl.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import { VSM_HANDLE_WGSL, VSM_PAGE_ADDRESS_WGSL, VSM_TABLE_ORIGIN_WGSL } from '../pageTableWgsl.ts'

/** The page-overlap pieces the cull reads (`renderCullWgsl.ts`). */
export const VSM_RENDER_OVERLAP_WGSL = wgslBlock(
  'VSM_RENDER_OVERLAP_WGSL',
  [
    VSM_CONSTANTS_WGSL,
    VSM_HANDLE_WGSL,
    VSM_PAGE_ADDRESS_WGSL,
    VSM_TABLE_ORIGIN_WGSL,
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
`,
)
