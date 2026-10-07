import { type WgslDecl, wgslBlock } from '../../../math/src/wgsl/decl.ts'

/** A source cell's width in original pixels, `2^k` at source level `k`, `s = max(o >> k, 1)` a
 *  side: the larger difference of the two sides' leading bits (`firstLeadingBit`), `2^k` built
 *  from its exponent bits. What `exp2(floor(log2(max(o.x/s.x, o.y/s.y))))` gives with an exact
 *  division, which WGSL allows a shader to round (`x·rcp(y)`), halving the step of an odd size. */
const REDUCTION_STEP_WGSL = wgslBlock(
  'REDUCTION_STEP_WGSL',
  [],
  `
fn reductionStep(o:vec2i,s:vec2i)->f32{
 let k=max(firstLeadingBit(o.x)-firstLeadingBit(s.x),firstLeadingBit(o.y)-firstLeadingBit(s.y));
 return bitcast<f32>(u32(k+127)<<23u);
}`,
)

/** The source cells a cell of the next level covers, `[start, end)`: two by two, the last cell
 *  owning an odd source tail. The host declares `extent`. */
const CELL_SPAN = `
 let sourceSize=vec2i(extent.xy);
 let start=pixel*2;
 let end=select(min(start+vec2i(2),sourceSize),sourceSize,pixel==max(sourceSize/2,vec2i(1))-vec2i(1));`

/** A cell of the next level over the source cells it covers (`mipRead`, the host's, `cellReductionWgsl`).
 *  Under `range`, their nearest/farthest pair in `.xy`, the reflection's depth bounds (`[1, 0]`
 *  where none holds a range); else their mean: unlike material alpha coverage, reflected radiance
 *  averages all four channels, weights counting original pixels (`extent.zw`), so a bright edge is
 *  neither discarded nor overweighted by later reductions. */
const cellReduction = (range: boolean) =>
  range
    ? `
fn cellReduction(pixel:vec2i)->vec4f{${CELL_SPAN}
 var range=vec2f(1.0,0.0);
 for(var y=start.y;y<end.y;y++){
  for(var x=start.x;x<end.x;x++){
   let value=mipRead(vec2i(x,y));
   range=vec2f(min(range.x,value.x),max(range.y,value.y));
  }
 }
 return vec4f(range,0.0,1.0);
}`
    : `
fn cellReduction(pixel:vec2i)->vec4f{${CELL_SPAN}
 let original=vec2f(extent.zw);
 let step=reductionStep(vec2i(extent.zw),sourceSize);
 var sum=vec4f(0.0);var area=0.0;
 for(var y=start.y;y<end.y;y++){
  for(var x=start.x;x<end.x;x++){
   let p=vec2i(x,y);let a=vec2f(p)*step;
   let b=select(min(a+vec2f(step),original),original,p==sourceSize-vec2i(1));
   let weight=(b.x-a.x)*(b.y-a.y);
   sum+=mipRead(p)*weight;area+=weight;
  }
 }
 return sum/area;
}`

/** The reduction of rule `range` and what it calls: the host's `read`, its `mipRead`
 *  (`fn mipRead(p:vec2i)->vec4f`, a declaration under that name), which it lists here so a
 *  reduction without one fails when the program is assembled. */
export const cellReductionWgsl = (read: WgslDecl, { range = false }: { range?: boolean } = {}) =>
  wgslBlock(
    `cellReductionWgsl(${range})`,
    range ? [read] : [read, REDUCTION_STEP_WGSL],
    cellReduction(range),
  )
