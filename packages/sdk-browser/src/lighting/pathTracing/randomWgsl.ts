import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { evolveSobolSeed, fastOwenScrambling, strongIntegerHash } from '../sobolScramblingWgsl.ts'

/**
 * THE PATH TRACER'S RANDOM NUMBERS (`PtRand`): a sequence a path draws from, one to four numbers at a time, each draw independent of the
 * ones before and each call stratified in its own dimensions.
 *
 * A draw is a point of an Owen-scrambled Sobol sequence: the index scrambled to decorrelate it from the other four-number draws, its two pairs
 * of dimensions evaluated in closed form (the second pair of the first from the first, the third and fourth from a bit reversal), then each
 * coordinate scrambled by a seed that moves at every draw (`evolveSobolSeed`, a multiplicative congruential step), so that the dimension a call
 * lands in follows the calls before it. The index of a sample is stored bit-reversed (the scrambling works from the high bit) and its seed starts
 * from a hash of the pixel.
 *
 * Two starts: `ptRandCreate` gives each pixel a sequence of its own (the sampler type 0), from the pixel's number and the sample's;
 * `ptRandCreateDiffused` (the sampler type 1) gives one sequence to the whole image, the sample's index made of the pixel's place along a
 * space-filling curve (`ptCurveIndex`, a Hilbert curve of the tile of 256 pixels a side that repeats), the frame and the sample, so that nearby
 * pixels draw nearby points and the error of the image spreads out like blue noise once all `maxSamples` are drawn.
 * `ptRandFloat` turns the upper 24 bits of a word into a number in [0, 1).
 */
export const PT_RANDOM_WGSL = wgslBlock(
  'PT_RANDOM_WGSL',
  [strongIntegerHash, evolveSobolSeed, fastOwenScrambling],
  `struct PtRand{index:u32,seed:u32,}
fn ptSobolDraw(index:u32,seed:ptr<function,u32>)->vec4u{
 let sobol=fastOwenScrambling(index,evolveSobolSeed(seed));
 var r=vec4u(sobol,sobol,0u,0u);
 var z=((sobol>>1u)&0x50550550u)^(sobol&0xaf5af5afu)^((sobol<<1u)&0xa0aa0aa0u);
 z^=z<<16u;
 z^=(z&0x00ff00ffu)<<8u;
 z^=(z&0x0f0f0f0fu)<<4u;
 z=((z>>1u)&0x50550550u)^(z&0x5fa5fa5fu)^((z<<1u)&0xa4ea4ea4u)^((z<<2u)&0xc84c84c8u)^((z<<3u)&0x08808808u);
 r.z=reverseBits(z);
 r.w=r.z;
 var yw=vec2u(r.y,r.w);
 yw^=yw>>vec2u(16u);
 yw^=(yw&vec2u(0xff00ff00u))>>vec2u(8u);
 yw^=(yw&vec2u(0xf0f0f0f0u))>>vec2u(4u);
 yw^=(yw&vec2u(0xccccccccu))>>vec2u(2u);
 yw^=(yw&vec2u(0xaaaaaaaau))>>vec2u(1u);
 r.y=yw.x;
 r.w=yw.y;
 r.x=fastOwenScrambling(r.x,evolveSobolSeed(seed));
 r.y=fastOwenScrambling(r.y,evolveSobolSeed(seed));
 r.z=fastOwenScrambling(r.z,evolveSobolSeed(seed));
 r.w=fastOwenScrambling(r.w,evolveSobolSeed(seed));
 return r;
}
fn ptRandBits(rand:ptr<function,PtRand>)->vec4u{
 var seed=(*rand).seed;
 let bits=ptSobolDraw((*rand).index,&seed);
 (*rand).seed=seed;
 return bits;
}
fn ptRandFloat(bits:vec4u)->vec4f{return vec4f(bits>>vec4u(8u))*5.96046447754e-08;}
fn ptRand1(rand:ptr<function,PtRand>)->f32{return ptRandFloat(ptRandBits(rand)).x;}
fn ptRand2(rand:ptr<function,PtRand>)->vec2f{return ptRandFloat(ptRandBits(rand)).xy;}
fn ptRand3(rand:ptr<function,PtRand>)->vec3f{return ptRandFloat(ptRandBits(rand)).xyz;}
fn ptRand4(rand:ptr<function,PtRand>)->vec4f{return ptRandFloat(ptRandBits(rand));}
fn ptRandCreate(pixelSeed:u32,frame:u32)->PtRand{
 return PtRand(reverseBits(frame),strongIntegerHash(pixelSeed));
}
fn ptCurveIndex(x:u32,y:u32)->u32{
 var hilbert=0u;var state=0u;
 for(var i=8;i>0;i--){
  let b=u32(i-1);
  let xi=(x>>b)&1u;
  let yi=(y>>b)&1u;
  let row=8u*state+4u*xi+2u*yi;
  hilbert=hilbert*4u+((0x361e9cb4u>>row)&3u);
  state=(0x8fe65831u>>row)&3u;
 }
 return hilbert;
}
fn ptRandCreateDiffused(pixel:vec2u,frame:u32,sample:u32,maxSamples:u32)->PtRand{
 let tile=ptCurveIndex(pixel.x,pixel.y)+frame*65536u;
 return PtRand(reverseBits(tile*maxSamples+sample),0u);
}`,
)
