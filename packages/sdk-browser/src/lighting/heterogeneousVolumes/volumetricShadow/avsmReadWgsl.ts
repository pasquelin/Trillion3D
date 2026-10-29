import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { AVSM_WGSL } from './avsmWgsl.ts'

/**
 * THE READ OF A COMPRESSED TEXEL of the adaptive volumetric shadow map: the transmittance at a distance, from the texel's indirection entry. The
 * distance is found by a binary search over the texel's samples (the second level of the atlas, offset by one from the first), and the
 * transmittance is the exponential fitted to the two samples round it; before the first sample it is one, past the last the last's. The program
 * declares avsmAtlasWord(index) -> u32, a word of the atlas.
 */
export const AVSM_READ_WGSL = wgslBlock(
  'AVSM_READ_WGSL',
  [AVSM_WGSL],
  `
fn avsmSafeRcp(v:f32)->f32{return select(0.0,1.0/v,v>0.0);}
/** The transmittance at z between two samples. A sample that lets nothing through leaves the fit its smallest ratio, not an infinite rate. */
fn avsmInterpolate(a:AvsmSample,b:AvsmSample,z:f32)->f32{
 let delta=max(b.x-a.x,0.0);
 let ratio=max(b.tau*avsmSafeRcp(a.tau),1.0e-30);
 let rate=-log(ratio)*avsmSafeRcp(delta);
 let x=clamp(z-a.x,0.0,delta);
 return saturate(a.tau*exp(-x*rate));
}
fn avsmSampleTexel(packed:vec4u,z:f32)->f32{
 let ind=avsmUnpackIndirection(packed);
 if(z<ind.beginX){return 1.0;}
 var before=AvsmSample(0.0,1.0);
 var after=AvsmSample(0.0,1.0);
 let top=avsmTopLevelCount(ind.sampleCount);
 if(top>0){
  let bottom=ind.pixelOffset+u32(avsmAlign4(top));
  if(z>=ind.endX){return avsmUnpackSample(avsmAtlasWord(bottom+u32(ind.sampleCount-1)),ind).tau;}
  before=avsmUnpackSample(avsmAtlasWord(ind.pixelOffset),ind);
  var low=-1;
  var high=ind.sampleCount-1;
  while(high-low>1){
   let middle=(low+high+1)/2;
   let current=avsmUnpackSample(avsmAtlasWord(bottom+u32(middle)),ind);
   if(z<current.x){high=middle;after=current;}else{low=middle;before=current;}
  }
 }
 return avsmInterpolate(before,after,z);
}
`,
)
