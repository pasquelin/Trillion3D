import { shaderLanguage } from '../math/shaderLanguage.ts'
/** A source cell's width in original pixels, \`2^k\` at source level \`k\`, \`s = max(o >> k, 1)\` a
 *  side: the larger difference of the two sides' leading bits, built from its exponent bits. What
 *  \`exp2(floor(log2(max(o.x/s.x, o.y/s.y))))\` gives with an exact division, which WGSL and GLSL
 *  allow a shader to round (\`x·rcp(y)\`), halving the step of an odd size. GLSL ES 3.00 has no
 *  \`findMSB\`: a size below 2^24 is exact in a float, whose exponent is its leading bit. */
const REDUCTION_STEP_WGSL = `
fn reductionStep(o:vec2i,s:vec2i)->f32{
 let k=max(firstLeadingBit(o.x)-firstLeadingBit(s.x),firstLeadingBit(o.y)-firstLeadingBit(s.y));
 return bitcast<f32>(u32(k+127)<<23u);
}`
const REDUCTION_STEP_GLSL = `
int leadingBit(int v){return (floatBitsToInt(float(v))>>23)-127;}
float reductionStep(ivec2 o,ivec2 s){
 int k=max(leadingBit(o.x)-leadingBit(s.x),leadingBit(o.y)-leadingBit(s.y));
 return intBitsToFloat((k+127)<<23);
}`

/** The source cells a cell of the next level covers, `[start, end)`: two by two, the last cell
 *  owning an odd source tail. The host declares `extent`. */
const CELL_SPAN = `
 var sourceSize:vec2i=vec2i(extent.xy);
 var destination:vec2i=max(sourceSize/2,vec2i(1));
 var start:vec2i=pixel*2;
 var end:vec2i=min(start+vec2i(2),sourceSize);
 if(pixel.x==destination.x-1){end.x=sourceSize.x;}
 if(pixel.y==destination.y-1){end.y=sourceSize.y;}`

/** A cell of the next level over the source cells it covers (`mipRead`, which the host declares).
 *  Under `range`, their nearest/farthest pair in `.xy`, the reflection's depth bounds (`[1, 0]`
 *  where none holds a range); else their mean: unlike material alpha coverage, reflected radiance
 *  averages all four channels, weights counting original pixels (`extent.zw`), so a bright edge is
 *  neither discarded nor overweighted by later reductions. */
const cellReduction = (range: boolean) =>
  range
    ? `
fn cellReduction(pixel:vec2i)->vec4f{${CELL_SPAN}
 var range:vec2f=vec2f(1.0,0.0);
 for(var y:i32=start.y;y<end.y;y++){
  for(var x:i32=start.x;x<end.x;x++){
   var value:vec4f=mipRead(vec2i(x,y));
   range=vec2f(min(range.x,value.x),max(range.y,value.y));
  }
 }
 return vec4f(range,0.0,1.0);
}`
    : `
fn cellReduction(pixel:vec2i)->vec4f{${CELL_SPAN}
 var original:vec2f=vec2f(extent.zw);
 var step:f32=reductionStep(vec2i(extent.zw),sourceSize);
 var sum:vec4f=vec4f(0.0);var area:f32=0.0;
 for(var y:i32=start.y;y<end.y;y++){
  for(var x:i32=start.x;x<end.x;x++){
   var p:vec2i=vec2i(x,y);var a:vec2f=vec2f(p)*step;
   var b:vec2f=min(a+vec2f(step),original);
   if(x==sourceSize.x-1){b.x=original.x;}
   if(y==sourceSize.y-1){b.y=original.y;}
   var weight:f32=(b.x-a.x)*(b.y-a.y);
   var value:vec4f=mipRead(p);
   sum+=value*weight;area+=weight;
  }
 }
 return sum/area;
}`

/** The reduction of rule `range` and what it calls, in each graphics API. */
export const cellReductionWgsl = (range: boolean) =>
  `${range ? '' : REDUCTION_STEP_WGSL}${cellReduction(range)}`
export const cellReductionGlsl = (range: boolean) =>
  `${range ? '' : REDUCTION_STEP_GLSL}${shaderLanguage(cellReduction(range), 'glsl')}`
