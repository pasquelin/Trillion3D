import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { VSM_PAGE_ADDRESS_WGSL } from './pageTableWgsl.ts'

/** A 2x2 gather as `name` over one table (its bounds test, loader and index): the 2x2
 *  texels at hierarchical mip pyramidMip in the order (-,+), (+,+), (+,-), (-,-), out-of-range ones 0. */
const gatherWgsl = (name: string, inBounds: string, load: string, index: string) =>
  wgslBlock(
    `gatherWgsl(${name})`,
    [VSM_PAGE_ADDRESS_WGSL],
    `
fn ${name}(texelCoord:vec2u,pyramidMip:u32)->vec4u{
 let t=texelCoord>>vec2u(pyramidMip);
 var a=array<vec2u,4>(vec2u(t.x,t.y+1u),vec2u(t.x+1u,t.y+1u),vec2u(t.x+1u,t.y),t);
 var r=vec4u(0u);
 for(var k=0u;k<4u;k++){
  if(${inBounds}(a[k],pyramidMip)){r[k]=${load}(${index}(a[k],pyramidMip));}
 }
 return r;
}`,
  )

/**
 * The 2x2 gather over the page marks (out-of-range texels read 0) and a page's own marks word,
 * through the module's `vsmPageMarksLoad(index:u32)->u32`.
 */
export const VSM_PAGE_MARKS_GATHER_WGSL = wgslBlock(
  'VSM_PAGE_MARKS_GATHER_WGSL',
  [
    VSM_PAGE_ADDRESS_WGSL,
    gatherWgsl('vsmGatherPageMarks', 'vsmPageMarkInBounds', 'vsmPageMarksLoad', 'vsmPageMarkIndex'),
  ],
  `fn vsmPageMarkWord(o:VsmTableCell)->u32{return vsmPageMarksLoad(vsmPageMarkIndex(o.tableXY,0u));}
`,
)

/** The same gather over the receiver covers, through the module's
 *  `vsmReceiverCoverLoad(index:u32)->u32`. */
export const VSM_COVER_GATHER_WGSL = gatherWgsl(
  'vsmGatherCover',
  'vsmCoverInBounds',
  'vsmReceiverCoverLoad',
  'vsmCoverIndex',
)
