import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'

/**
 * THE FILTER OF A CLASSIC SHADOW IN THE SHADERS (`pcf.ts` is its twin, and says what each function is): the visibility of a texel, the 5 by 5 window's filter over the 36
 * visibilities a kernel fetched (row by row), the blur's correction, a cascade's weight and the transition scale of a receiver.
 */
export const CLASSIC_PCF_WGSL = wgslBlock(
  'CLASSIC_PCF_WGSL',
  [],
  `
fn classicTransitionVisibility(stored:f32,depth:f32,scale:f32)->f32{
 return saturate(stored*scale-(depth*scale-1.0));
}
fn classicPcfWeights(fraction:f32)->array<f32,6>{
 return array<f32,6>(1.0-fraction,1.0,1.0,1.0,1.0,fraction);
}
fn classicPcf5x5(fraction:vec2f,values:array<f32,36>)->f32{
 let wx=classicPcfWeights(fraction.x);
 let wy=classicPcfWeights(fraction.y);
 var sum=0.0;
 for(var y=0u;y<6u;y++){
  for(var x=0u;x<6u;x++){sum+=values[y*6u+x]*wx[x]*wy[y];}
 }
 return sum*0.04;
}
fn classicOverBlurCorrection(visibility:f32)->f32{return visibility*visibility;}
fn classicCascadeBlend(depth:f32,fadePlane:f32,fadeLength:f32)->f32{
 if(fadeLength<=0.0){return 1.0;}
 return 1.0-saturate((depth-fadePlane)/fadeLength);
}
fn classicReceiverTransitionScale(scale:f32,receiverBias:f32,cosine:f32)->f32{
 return scale*(1.0-receiverBias+receiverBias*saturate(cosine));
}
`,
)
