import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import {
  EXPOSURE_HISTOGRAM_BUCKETS,
  EXPOSURE_MIDDLE_GREY,
} from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { curveWgsl } from './curveWgsl.ts'
import { LOCAL_LOG_WGSL } from './localLogWgsl.ts'
import { HISTOGRAM_WORDS, METER_LANES, METER_PARAMS, WEIGHT_ONE } from './meterLayout.ts'

const BUCKETS = EXPOSURE_HISTOGRAM_BUCKETS
const LAST = BUCKETS - 1
/** The fixed point's unit as a literal, and the weight a carry stands for. */
const ONE = `${WEIGHT_ONE}.0`
const CARRY = `${2 ** 32 / WEIGHT_ONE}.0`
const GREY = wgslF32(EXPOSURE_MIDDLE_GREY)

/**
 * The histogram of the image's luminance, one workgroup a row of its half-resolution grid. Each
 * half pixel is the mean of its 2 × 2 source pixels — a pixel past the last row or column reads the
 * last —, the radiance read as the composition reads it, the colour over its coverage, divided by the
 * pre-exposure it was written with; its
 * luminance, no lower than the histogram's lowest, is placed by its logarithm between two buckets,
 * the weight shared by how near each lies; the darkest bucket's weight is scaled (the pixels of no
 * light). The lanes count their pixels in the workgroup's own buckets, then each lane adds its
 * bucket into the buffer's, the carry out of the low word into the high one.
 */
export const MEASURE_WGSL = wgslProgram(
  `
${METER_PARAMS.wgsl}
@group(0) @binding(0) var image:texture_2d<f32>;
@group(0) @binding(1) var<uniform> meter:MeterParams;
@group(0) @binding(2) var<storage,read_write> histogram:array<atomic<u32>,${HISTOGRAM_WORDS}>;
var<workgroup> counts:array<atomic<u32>,${BUCKETS}>;
fn halfPixel(x:u32,y:u32)->vec4f{
 let last=vec2i(meter.size.xy)-vec2i(1);
 let at=vec2i(i32(x*2u),i32(y*2u));
 let a=textureLoad(image,min(at,last),0);
 let b=textureLoad(image,min(at+vec2i(1,0),last),0);
 let c=textureLoad(image,min(at+vec2i(0,1),last),0);
 let d=textureLoad(image,min(at+vec2i(1,1),last),0);
 return (a+b+c+d)*0.25;
}
@compute @workgroup_size(${METER_LANES})
fn measure(@builtin(workgroup_id) rowAt:vec3u,@builtin(local_invocation_index) lane:u32){
 atomicStore(&counts[lane],0u);
 workgroupBarrier();
 for(var x=lane;x<meter.size.z;x+=${METER_LANES}u){
  let pixel=halfPixel(x,rowAt.x);
  let radiance=pixel.rgb/max(pixel.a,1e-6)*meter.image.x;
  let light=max(dot(radiance,meter.weights.xyz),meter.weights.w);
  let place=saturate(log2(light)*meter.histogram.x+meter.histogram.y)*${wgslF32(LAST)};
  let low=min(u32(place),${LAST}u);
  let high=min(low+1u,${LAST}u);
  let share=fract(place);
  var kept=1.0-share;
  if(low==0u){kept=kept*meter.histogram.z;}
  atomicAdd(&counts[low],u32(kept*${ONE}));
  atomicAdd(&counts[high],u32(share*${ONE}));
 }
 workgroupBarrier();
 let mine=atomicLoad(&counts[lane]);
 if(mine!=0u){
  let before=atomicAdd(&histogram[lane*2u],mine);
  if(0xffffffffu-mine<before){atomicAdd(&histogram[lane*2u+1u],1u);}
 }
}`,
  [],
)

/**
 * The exposure, one thread: the histogram's weights, the mean of the logarithms of luminance
 * between the two shares (the darkest, then the brightest, left out), the mean held to the range,
 * and the exposure moved toward what that mean asks — `bias · 0.18 / mean` —, in stops: linearly
 * while it is farther than the transition distance, exponentially inside it, at the rise's or the
 * fall's speed, or at once where the update jumps. The exposure is then held to the range as well,
 * and its scale over the pre-exposure the image holds is left beside it, with the mean the local
 * exposure's gain takes over the histogram (1 where it does not run; the mean of the logarithms of
 * the gain at each bucket's luminance, weighted by the bucket) — the factor the next image's
 * pre-exposure carries. The bias is multiplied by the compensation curve's factor at the frame's
 * mean (`curveFactor`; 1 without a curve).
 * A pixel-less histogram asks the lowest mean; a share of the low and the high alike gives a mean
 * of 1, the reference's.
 */
export const ADAPT_WGSL = wgslProgram(
  `
${METER_PARAMS.wgsl}
@group(0) @binding(0) var<uniform> meter:MeterParams;
@group(0) @binding(1) var<storage,read> histogram:array<u32,${HISTOGRAM_WORDS}>;
@group(0) @binding(2) var<storage,read_write> exposure:array<vec4f,2>;
${curveWgsl(3)}
fn weightOf(i:u32)->f32{
 return f32(histogram[i*2u+1u])*${CARRY}+f32(histogram[i*2u])*${wgslF32(1 / WEIGHT_ONE)};
}
fn meanLuminance(total:f32)->f32{
 if(abs(meter.bounds.z-meter.bounds.w)<0.0001){return 1.0;}
 var below=total*meter.bounds.z;
 var above=total*meter.bounds.w;
 var logSum=0.0;
 var kept=0.0;
 for(var i=0u;i<${BUCKETS}u;i++){
  var weight=weightOf(i);
  let leftOut=min(weight,below);
  weight=weight-leftOut;
  below=below-leftOut;
  above=above-leftOut;
  weight=min(weight,above);
  above=above-weight;
  let logLuminance=(f32(i)/${wgslF32(LAST)}-meter.histogram.y)/meter.histogram.x;
  logSum=logSum+logLuminance*weight;
  kept=kept+weight;
 }
 if(kept==0.0){return meter.bounds.x/${GREY};}
 return exp2(logSum/kept);
}
fn moved(old:f32,goal:f32)->f32{
 let logGoal=log2(goal);
 let logOld=log2(old);
 let gap=logGoal-logOld;
 let rising=gap>0.0;
 let travel=meter.speeds.w*select(meter.speeds.y,meter.speeds.x,rising);
 let multiplier=select(meter.response.y,meter.response.x,rising);
 let exponential=logOld+gap*(1.0-exp2(-travel))*multiplier;
 let linear=select(max(logGoal,logOld-travel),min(logGoal,logOld+travel),logOld<logGoal);
 let next=exp2(select(exponential,linear,abs(gap)>meter.speeds.z));
 return mix(next,goal,meter.response.w);
}
fn averageLocal(scale:f32,bias:f32)->f32{
 let grey=meter.local.x+log2(bias);
 var logSum=0.0;
 var total=0.0;
 for(var i=0u;i<${BUCKETS}u;i++){
  let weight=weightOf(i);
  let logLuminance=(f32(i)/${wgslF32(LAST)}-meter.histogram.y)/meter.histogram.x;
  let base=logLuminance+log2(scale);
  logSum=logSum+(localLog(base,grey,meter.local.yz,meter.edges.xy,meter.edges.zw)-base)*weight;
  total=total+weight;
 }
 return exp2(logSum/max(0.0001,total));
}
@compute @workgroup_size(1)
fn adapt(){
 var total=0.0;
 for(var i=0u;i<${BUCKETS}u;i++){total=total+weightOf(i);}
 let mean=meanLuminance(total);
 let goal=clamp(mean,meter.bounds.x,meter.bounds.y)/${GREY};
 let bias=meter.response.z*curveFactor(mean);
 let held=exposure[0].x;
 let old=bias/select(1.0,held,held>0.0&&held<1e30);
 let estimated=moved(old,goal);
 let reached=clamp(estimated,meter.bounds.x/${GREY},meter.bounds.y/${GREY});
 let next=bias/max(0.0001,reached);
 exposure[0]=vec4f(next,bias/max(0.0001,goal),mean,bias);
 let localMean=select(1.0,averageLocal(next,bias),meter.local.w!=0.0);
 exposure[1]=vec4f(next*meter.image.x,localMean,0.0,0.0);
}`,
  [LOCAL_LOG_WGSL],
)
