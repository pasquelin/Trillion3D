/**
 * THE COMPUTE THROTTLE'S KERNELS (`throttle.ts`), run in the marking while the throttle is on:
 * `vsmThrottleClear`, a thread a word of a buffer, zeroes the throttle buffer before the carry and the feedback after the fit;
 * `vsmThrottleProcess`, a thread a previous map id, carries the previous frame's cluster counts and
 * intensity to the map's id of this frame, and `vsmThrottleUpdate`, a thread a map of this frame, fits
 * the intensities and adds their levels to the maps' bias in the projection data.
 *
 * The throttle buffer (`VSM_TB_*`): a header of the frame's totals, its greatest counts and the global
 * intensity, then for each map slot its two counts and its intensity, as f32 bits.
 */
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import {
  VSM_CONSTANTS_WGSL,
  VSM_MAX_SINGLE_PAGE_MAPS,
  VSM_PROJECTION_RECORD_BYTES,
} from './constants.ts'
import {
  VSM_PROJECTION_KIND_WORD,
  VSM_PROJECTION_LEVEL_BIAS_WORD,
} from './projection/projectionData.ts'
import { VSM_FEEDBACK_WGSL } from './render/renderParamsWgsl.ts'

/** The throttle buffer's header and entry (`VSM_TB_*`). */
const VSM_TB_HEADER_TOTAL_HW_CLUSTERS = 0
const VSM_TB_HEADER_TOTAL_SW_CLUSTERS = 1
const VSM_TB_HEADER_MAX_HW_CLUSTERS = 2
const VSM_TB_HEADER_MAX_SW_CLUSTERS = 3
const VSM_TB_HEADER_TOTAL_THROTTLE = 4
const VSM_TB_SIZEOF_HEADER = 5
const VSM_TB_ENTRY_HW_CLUSTERS = 0
const VSM_TB_ENTRY_SW_CLUSTERS = 1
const VSM_TB_ENTRY_THROTTLE = 2
const VSM_TB_SIZEOF_ENTRY = 3

/** The words of the throttle buffer of `mapSlots` map slots. */
export const vsmThrottleWords = (mapSlots: number) =>
  VSM_TB_SIZEOF_HEADER + VSM_TB_SIZEOF_ENTRY * mapSlots

export const VSM_THROTTLE_PROCESS_ENTRY = 'vsmThrottleProcess'
export const VSM_THROTTLE_UPDATE_ENTRY = 'vsmThrottleUpdate'
export const VSM_THROTTLE_CLEAR_ENTRY = 'vsmThrottleClear'

/** The kernels' parameters: the previous frame's map count (the next-map data's), this frame's, the
 *  dynamic resolution's strength (−1 for none), the load budget, the history weight and the most each
 *  kind of light may add. */
export const VSM_THROTTLE_PARAMS = fieldLayout('VsmThrottleParams', [
  ['nextCount', 'u32'],
  ['slotCount', 'u32'],
  ['strength', 'f32'],
  ['loadBudget', 'f32'],
  ['historyWeight', 'f32'],
  ['maxBiasDirectional', 'f32'],
  ['maxBiasLocal', 'f32'],
  ['singleMaps', 'u32'],
] as const)

/** The estimate of the raster's cost of a cluster of the hardware raster and of the software raster. */
const COST_HARDWARE = '0.00012176',
  COST_SOFTWARE = '0.000027'

/** The kernels' parameters at binding 0, and the throttle buffer's layout. */
const VSM_THROTTLE_PARAMS_WGSL = wgslBlock(
  'VSM_THROTTLE_PARAMS_WGSL',
  [VSM_FEEDBACK_WGSL],
  /* wgsl */ `
${VSM_THROTTLE_PARAMS.wgsl}
@group(0) @binding(0) var<uniform> params:VsmThrottleParams;
${wgslConsts({
  VSM_TB_HEADER_TOTAL_HW_CLUSTERS,
  VSM_TB_HEADER_TOTAL_SW_CLUSTERS,
  VSM_TB_HEADER_MAX_HW_CLUSTERS,
  VSM_TB_HEADER_MAX_SW_CLUSTERS,
  VSM_TB_HEADER_TOTAL_THROTTLE,
  VSM_TB_SIZEOF_HEADER,
  VSM_TB_ENTRY_HW_CLUSTERS,
  VSM_TB_ENTRY_SW_CLUSTERS,
  VSM_TB_ENTRY_THROTTLE,
  VSM_TB_SIZEOF_ENTRY,
})}
`,
)

/** Group 0 of `vsmThrottleProcess`: 0 the parameters (uniform), 1 the previous throttle buffer, 2 the
 *  previous feedback, 3 the next-map data by previous id (vec4u: flags, next id), 4 this frame's
 *  throttle buffer (rw). Dispatch: a thread a previous id, one workgroup at least. */
export const VSM_THROTTLE_PROCESS_WGSL = wgslProgram(
  /* wgsl */ `
@group(0) @binding(1) var<storage,read> prevThrottle:array<u32>;
@group(0) @binding(2) var<storage,read> prevFeedback:array<u32>;
@group(0) @binding(3) var<storage,read> nextMaps:array<vec4u>;
@group(0) @binding(4) var<storage,read_write> outThrottle:array<atomic<u32>>;
@compute @workgroup_size(WORKGROUP_THREADS) fn ${VSM_THROTTLE_PROCESS_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 let previous=id.x;
 if(previous==0u){
  atomicStore(&outThrottle[VSM_TB_HEADER_TOTAL_HW_CLUSTERS],prevFeedback[VSM_FEEDBACK_HW]);
  atomicStore(&outThrottle[VSM_TB_HEADER_TOTAL_SW_CLUSTERS],prevFeedback[VSM_FEEDBACK_SW]);
 }
 if(previous>=params.nextCount){return;}
 let next=nextMaps[previous];
 if((next.x&VSM_NEXT_ID_VALID)==0u){return;}
 let counts=VSM_FEEDBACK_HEADER_WORDS+VSM_FEEDBACK_ENTRY_WORDS*previous;
 let hardware=prevFeedback[counts+VSM_FEEDBACK_HW];
 let software=prevFeedback[counts+VSM_FEEDBACK_SW];
 let slot=VSM_TB_SIZEOF_HEADER+VSM_TB_SIZEOF_ENTRY*next.y;
 atomicStore(&outThrottle[slot+VSM_TB_ENTRY_HW_CLUSTERS],hardware);
 atomicStore(&outThrottle[slot+VSM_TB_ENTRY_SW_CLUSTERS],software);
 atomicStore(&outThrottle[slot+VSM_TB_ENTRY_THROTTLE],prevThrottle[VSM_TB_SIZEOF_HEADER+VSM_TB_SIZEOF_ENTRY*previous+VSM_TB_ENTRY_THROTTLE]);
 atomicMax(&outThrottle[VSM_TB_HEADER_MAX_HW_CLUSTERS],hardware);
 atomicMax(&outThrottle[VSM_TB_HEADER_MAX_SW_CLUSTERS],software);
}
`,
  [WORKGROUP_THREADS_WGSL, VSM_CONSTANTS_WGSL, VSM_THROTTLE_PARAMS_WGSL],
)

/** Group 0 of `vsmThrottleUpdate`: 0 the parameters (uniform), 1 the previous throttle buffer, 2 this
 *  frame's (rw), 3 the projection data's words (rw). Dispatch: a thread a map slot of this frame, one
 *  workgroup at least. */
export const VSM_THROTTLE_UPDATE_WGSL = wgslProgram(
  /* wgsl */ `${wgslConsts({
    VSM_PROJECTION_RECORD_WORDS: VSM_PROJECTION_RECORD_BYTES / 4,
    VSM_PROJECTION_KIND_WORD,
    VSM_PROJECTION_LEVEL_BIAS_WORD,
  })}
@group(0) @binding(1) var<storage,read> prevThrottle:array<u32>;
@group(0) @binding(2) var<storage,read_write> outThrottle:array<atomic<u32>>;
@group(0) @binding(3) var<storage,read_write> projectionWords:array<u32>;
/** The estimate of the raster's cost of clusters of the hardware raster and of the software raster. */
fn vsmThrottleCost(hardware:f32,software:f32)->f32{return ${COST_HARDWARE}*hardware+${COST_SOFTWARE}*software;}
@compute @workgroup_size(WORKGROUP_THREADS) fn ${VSM_THROTTLE_UPDATE_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 let totalHardware=atomicLoad(&outThrottle[VSM_TB_HEADER_TOTAL_HW_CLUSTERS]);
 let totalSoftware=atomicLoad(&outThrottle[VSM_TB_HEADER_TOTAL_SW_CLUSTERS]);
 let mostHardware=atomicLoad(&outThrottle[VSM_TB_HEADER_MAX_HW_CLUSTERS]);
 let mostSoftware=atomicLoad(&outThrottle[VSM_TB_HEADER_MAX_SW_CLUSTERS]);
 var globalIntensity:f32;
 if(params.strength>=0.0){
  globalIntensity=params.strength;
 }else{
  // Hand-tuned: how fast the global intensity follows the load, and its steps up and down.
  let response=0.5;
  let stepUp=0.2;
  let stepDown=-0.01;
  let excess=vsmThrottleCost(f32(totalHardware),f32(totalSoftware))-params.loadBudget;
  let modifier=clamp(excess*response,stepDown,stepUp);
  let before=bitcast<f32>(prevThrottle[VSM_TB_HEADER_TOTAL_THROTTLE]);
  globalIntensity=saturate(before+modifier);
 }
 if(id.x==0u){atomicStore(&outThrottle[VSM_TB_HEADER_TOTAL_THROTTLE],bitcast<u32>(globalIntensity));}
 if(id.x>=params.slotCount){return;}
 if(id.x>=params.singleMaps&&id.x<${VSM_MAX_SINGLE_PAGE_MAPS}u){return;}
 let slot=VSM_TB_SIZEOF_HEADER+VSM_TB_SIZEOF_ENTRY*id.x;
 let hardware=atomicLoad(&outThrottle[slot+VSM_TB_ENTRY_HW_CLUSTERS]);
 let software=atomicLoad(&outThrottle[slot+VSM_TB_ENTRY_SW_CLUSTERS]);
 var intensity:f32;
 if(hardware+software==0u){
  // Likely no data: the global value.
  intensity=globalIntensity;
 }else{
  let before=bitcast<f32>(atomicLoad(&outThrottle[slot+VSM_TB_ENTRY_THROTTLE]));
  let share=vsmThrottleCost(f32(hardware),f32(software))/vsmThrottleCost(f32(mostHardware),f32(mostSoftware));
  intensity=saturate(share*globalIntensity);
  intensity=intensity*(1.0-params.historyWeight)+before*params.historyWeight;
 }
 let record=id.x*VSM_PROJECTION_RECORD_WORDS;
 let most=select(params.maxBiasLocal,params.maxBiasDirectional,projectionWords[record+VSM_PROJECTION_KIND_WORD]==LIGHT_KIND_DIRECTIONAL);
 projectionWords[record+VSM_PROJECTION_LEVEL_BIAS_WORD]=bitcast<u32>(bitcast<f32>(projectionWords[record+VSM_PROJECTION_LEVEL_BIAS_WORD])+intensity*most);
 atomicStore(&outThrottle[slot+VSM_TB_ENTRY_THROTTLE],bitcast<u32>(intensity));
}
`,
  [WORKGROUP_THREADS_WGSL, VSM_CONSTANTS_WGSL, VSM_THROTTLE_PARAMS_WGSL],
)

/** Group 0 of `vsmThrottleClear`: 0 the buffer to zero (rw). Dispatch: a thread a word of it, one workgroup at least. */
export const VSM_THROTTLE_CLEAR_WGSL = wgslProgram(
  /* wgsl */ `
@group(0) @binding(0) var<storage,read_write> words:array<u32>;
@compute @workgroup_size(WORKGROUP_THREADS) fn ${VSM_THROTTLE_CLEAR_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(id.x<arrayLength(&words)){words[id.x]=0u;}
}
`,
  [WORKGROUP_THREADS_WGSL],
)
