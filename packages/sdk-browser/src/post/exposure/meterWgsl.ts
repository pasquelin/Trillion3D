import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import {
  EXPOSURE_HISTOGRAM_BUCKETS,
  EXPOSURE_MIDDLE_GREY,
} from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { BASIC_MEASURE_WGSL } from './basicWgsl.ts'
import { curveWgsl } from './curveWgsl.ts'
import { LOCAL_LOG_WGSL } from './localLogWgsl.ts'
import { BASIC_LANES, METER_LANES, METER_PARAMS, METER_WORDS, WEIGHT_ONE } from './meterLayout.ts'
import { METER_LIGHT_WGSL } from './meterLightWgsl.ts'

const BUCKETS = EXPOSURE_HISTOGRAM_BUCKETS
const LAST = BUCKETS - 1
/** The fixed point's unit as a literal, and the weight a carry stands for. */
const ONE = `${WEIGHT_ONE}.0`
const CARRY = `${2 ** 32 / WEIGHT_ONE}.0`
const GREY = wgslF32(EXPOSURE_MIDDLE_GREY)

/**
 * The histogram of the luminance of the scene's half-size image (`image`, the chain's), one
 * workgroup a row of it. Each texel is read as it is, the radiance read as the composition reads it,
 * the colour as it is, divided by the pre-exposure it was written with; its
 * luminance, no lower than the histogram's lowest, is placed by its logarithm between two buckets,
 * the weight shared by how near each lies; the darkest bucket's weight is scaled (the pixels of no
 * light), and both are scaled by the metering mask (`maskWeight`, 1 where no mask is bound), read
 * once for each 2 × 2 quad of texels, at the quad's first one (`quadWeight`); a quad that is not
 * whole (the last column or row of an odd image) is left out. The lanes count their
 * pixels in the workgroup's own buckets, then each lane adds its bucket into the buffer's, the carry out of the low word into the high one. The
 * program holds the basic measure's entry as well (`basicWgsl.ts`), which shares its bindings and
 * reads the grid's last level in place of the image.
 */
export const MEASURE_WGSL = wgslProgram(
  `
${METER_PARAMS.wgsl}
@group(0) @binding(0) var image:texture_2d<f32>;
@group(0) @binding(1) var<uniform> meter:MeterParams;
@group(0) @binding(2) var<storage,read_write> histogram:array<atomic<u32>,${METER_WORDS}>;
@group(0) @binding(3) var meterMask:texture_2d<f32>;
@group(0) @binding(4) var meterSampler:sampler;
var<workgroup> counts:array<atomic<u32>,${BUCKETS}>;
fn maskWeight(uv:vec2f)->f32{
 if(meter.image.w==0.0){return 1.0;}
 return textureSampleLevel(meterMask,meterSampler,uv,0.0).x;
}
fn quadWeight(x:u32,row:u32)->f32{
 return maskWeight(vec2f(vec2u(x&~1u,row&~1u))/vec2f(meter.size.zw));
}
@compute @workgroup_size(${METER_LANES})
fn measure(@builtin(workgroup_id) rowAt:vec3u,@builtin(local_invocation_index) lane:u32){
 atomicStore(&counts[lane],0u);
 workgroupBarrier();
 for(var x=lane;x<meter.size.z;x+=${METER_LANES}u){
  if((x|1u)>=meter.size.z||(rowAt.x|1u)>=meter.size.w){continue;}
  let screen=quadWeight(x,rowAt.x);
  let light=meterLight(textureLoad(image,vec2i(i32(x),i32(rowAt.x)),0),meter.weights.xyz,meter.image.x,meter.weights.w);
  let place=saturate(log2(light)*meter.histogram.x+meter.histogram.y)*${wgslF32(LAST)};
  let low=min(u32(place),${LAST}u);
  let high=min(low+1u,${LAST}u);
  let share=fract(place);
  var kept=1.0-share;
  if(low==0u){kept=kept*meter.histogram.z;}
  atomicAdd(&counts[low],u32(kept*screen*${ONE}));
  atomicAdd(&counts[high],u32(share*screen*${ONE}));
 }
 workgroupBarrier();
 let mine=atomicLoad(&counts[lane]);
 if(mine!=0u){
  let before=atomicAdd(&histogram[lane*2u],mine);
  if(0xffffffffu-mine<before){atomicAdd(&histogram[lane*2u+1u],1u);}
 }
}`,
  [METER_LIGHT_WGSL, BASIC_MEASURE_WGSL],
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
 * mean (`curveFactor`; 1 without a curve), and the log2 of the middle grey the local exposure
 * pulls toward — 0.18 times the bias, the curve's factor and two to the local bias — is left too,
 * which the finishing copies. A pixel-less histogram asks the lowest mean; a share of the low and
 * the high alike gives a mean of 1, the reference's.
 *
 * Where the method is the basic one (`meter.image.z`), the measure left the four sums of each of
 * its lanes (`laneSum`): the mean is the weighted mean of the grid's log luminance over all of
 * them (`basicMean`), and the local exposure's mean is the mean of the gain each lane's plain mean
 * gives, weighted by the lane's texels (`basicLocal`), as the histogram's is over its buckets.
 */
export const ADAPT_WGSL = wgslProgram(
  `
${METER_PARAMS.wgsl}
@group(0) @binding(0) var<uniform> meter:MeterParams;
@group(0) @binding(1) var<storage,read> histogram:array<u32,${METER_WORDS}>;
@group(0) @binding(2) var<storage,read_write> exposure:array<vec4f,2>;
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
fn laneSum(lane:u32)->vec4f{
 return vec4f(bitcast<f32>(histogram[lane*4u]),bitcast<f32>(histogram[lane*4u+1u]),bitcast<f32>(histogram[lane*4u+2u]),bitcast<f32>(histogram[lane*4u+3u]));
}
fn gridLog(placed:f32)->f32{return (placed-meter.histogram.y)/meter.histogram.x;}
fn basicMean()->f32{
 var sum=vec2f(0.0);
 for(var lane=0u;lane<${BASIC_LANES}u;lane++){sum=sum+laneSum(lane).xy;}
 return exp2(gridLog(sum.x/max(sum.y,1e-10)));
}
fn basicLocal(scale:f32,grey:f32)->f32{
 var logSum=0.0;
 var total=0.0;
 for(var lane=0u;lane<${BASIC_LANES}u;lane++){
  let sums=laneSum(lane);
  if(sums.w>0.0){
   let base=gridLog(sums.z/sums.w)+log2(scale);
   logSum=logSum+(localLog(base,grey,meter.local.yz,meter.edges.xy,meter.edges.zw)-base)*sums.w;
   total=total+sums.w;
  }
 }
 return exp2(logSum/max(0.0001,total));
}
fn averageLocal(scale:f32,grey:f32)->f32{
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
fn histogramMean()->f32{
 var total=0.0;
 for(var i=0u;i<${BUCKETS}u;i++){total=total+weightOf(i);}
 return meanLuminance(total);
}
@compute @workgroup_size(1)
fn adapt(){
 let basic=meter.image.z!=0.0;
 var mean=1.0;
 if(basic){mean=basicMean();}else{mean=histogramMean();}
 let goal=clamp(mean,meter.bounds.x,meter.bounds.y)/${GREY};
 let bias=meter.response.z*curveFactor(mean,meter.image.y);
 let held=exposure[0].x;
 let old=bias/select(1.0,held,held>0.0&&held<1e30);
 let estimated=moved(old,goal);
 let reached=clamp(estimated,meter.bounds.x/${GREY},meter.bounds.y/${GREY});
 let next=bias/max(0.0001,reached);
 exposure[0]=vec4f(next,bias/max(0.0001,goal),mean,bias);
 let grey=meter.local.x+log2(bias);
 var localMean=1.0;
 if(meter.local.w!=0.0){
  if(basic){localMean=basicLocal(next,grey);}else{localMean=averageLocal(next,grey);}
 }
 exposure[1]=vec4f(next*meter.image.x,localMean,grey,0.0);
}`,
  [LOCAL_LOG_WGSL, curveWgsl(3)],
)
