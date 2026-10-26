import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { EXPOSURE_HISTOGRAM_BUCKETS } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { METER_LIGHT_WGSL } from './meterLightWgsl.ts'
import {
  BASIC_LANES,
  BASIC_LOG_HIGH,
  BASIC_LOG_LOW,
  BASIC_LUMINANCE_MIN,
  BASIC_SIDE,
  METER_PARAMS,
} from './meterLayout.ts'

/** The side, in texels, of the groups the setup runs in. */
export const SETUP_GROUP = 8

/**
 * THE BASIC METHOD'S SETUP, the program `basicSetup`: the image at a quarter of its size — the
 * level of the scene's chain after the half-size image — read texel by texel, each texel's colour
 * read by the meter (`meterLight`, no lower than `BASIC_LUMINANCE_MIN`), its log2 held between −10
 * and 20 stops and placed over the histogram's range by its scale and bias (`scaledLog`), into the
 * alpha of a texel of the same place; the rest of the texel is 0. The grid the measure sums is the
 * levels under it, each the mean of the 4 × 4 texels around the one above.
 */
export const BASIC_SETUP_WGSL = wgslProgram(
  `
${METER_PARAMS.wgsl}
@group(0) @binding(0) var quarter:texture_2d<f32>;
@group(0) @binding(1) var logged:texture_storage_2d<${HDR_FORMAT},write>;
@group(0) @binding(2) var<uniform> meter:MeterParams;
fn scaledLog(colour:vec4f)->f32{
 let luminance=meterLight(colour,meter.weights.xyz,meter.image.x,${wgslF32(BASIC_LUMINANCE_MIN)});
 return clamp(log2(luminance),${wgslF32(BASIC_LOG_LOW)},${wgslF32(BASIC_LOG_HIGH)})*meter.histogram.x+meter.histogram.y;
}
@compute @workgroup_size(${SETUP_GROUP},${SETUP_GROUP})
fn basicSetup(@builtin(global_invocation_id) at:vec3u){
 if(any(at.xy>=textureDimensions(quarter))){return;}
 textureStore(logged,vec2i(at.xy),vec4f(0.0,0.0,0.0,scaledLog(textureLoad(quarter,vec2i(at.xy),0))));
}`,
  [METER_LIGHT_WGSL],
)

/**
 * THE BASIC MEASURE, the entry `measureBasic` of the meter's measure program (it reads that
 * program's bindings, the image being the grid's last level — the placed log luminance in its
 * alpha —, and `maskWeight`): one workgroup of 256 lanes over the grid, each lane the share of its
 * texels that a sixteenth of each axis makes (`laneRange`, the same split of the grid at any size).
 * A texel weighs the metering mask at its corner (`maskWeight`), no less than 0.05 where a mask is
 * bound, and the weight of the darkest bucket's share where its placed value falls in the
 * histogram's first bucket (the pixels of no light), `texelTerms`: its weighted value, its weight,
 * its value and 1. A lane sums its texels, a column of them before the columns (`laneSums`), and
 * leaves the four sums in its own words of the buffer (`leaveLane`) as float bits, for the update to
 * take the mean of the whole grid from and the local exposure's gain lane by lane.
 */
export const BASIC_MEASURE_WGSL = wgslBlock(
  'BASIC_MEASURE_WGSL',
  [],
  `
fn texelTerms(at:vec2u,size:vec2f)->vec4f{
 let placed=textureLoad(image,vec2i(at),0).w;
 var weight=max(maskWeight(vec2f(at)/size),0.05);
 if(u32(saturate(placed)*${wgslF32(EXPOSURE_HISTOGRAM_BUCKETS - 1)})==0u){weight=weight*meter.histogram.z;}
 return vec4f(weight*placed,weight,placed,1.0);
}
fn laneRange(lane:u32,size:vec2f)->vec4f{
 let share=vec2f(f32(lane%${BASIC_SIDE}u),floor(f32(lane)/${wgslF32(BASIC_SIDE)}));
 return vec4f(floor(size*share/${wgslF32(BASIC_SIDE)}),floor(size*(share+vec2f(1.0))/${wgslF32(BASIC_SIDE)}));
}
fn laneSums(lane:u32,size:vec2f)->vec4f{
 let range=laneRange(lane,size);
 var sum=vec4f(0.0);
 for(var x=u32(range.x);x<u32(range.z);x++){
  var column=vec4f(0.0);
  for(var y=u32(range.y);y<u32(range.w);y++){column=column+texelTerms(vec2u(x,y),size);}
  sum=sum+column;
 }
 return sum;
}
fn leaveLane(lane:u32,sums:vec4f){
 atomicStore(&histogram[lane*4u],bitcast<u32>(sums.x));
 atomicStore(&histogram[lane*4u+1u],bitcast<u32>(sums.y));
 atomicStore(&histogram[lane*4u+2u],bitcast<u32>(sums.z));
 atomicStore(&histogram[lane*4u+3u],bitcast<u32>(sums.w));
}
@compute @workgroup_size(${BASIC_LANES})
fn measureBasic(@builtin(local_invocation_index) lane:u32){
 leaveLane(lane,laneSums(lane,vec2f(textureDimensions(image))));
}`,
)
