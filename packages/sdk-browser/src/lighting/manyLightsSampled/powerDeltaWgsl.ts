/**
 * THE CHANGE OF EACH LIGHT'S POWER (`sampledLightsPowerDelta`), once an image before any sampling: one thread a light, the simple lights after the scene's. A light's power is its colour's luminance times its strength (a rectangle's
 * times its area), times the larger of its shares of diffuse and specular light, times the pre-exposure; with `sampledLightsPowerDeltaLightFunctions` the light function is in the colour,
 * evaluated once, at the light's place (a sun's at the eye). The ratio of the power of the image before to this one's (over 0.01 at least, 1 where the light has no history, the history of a light found by its identity in the view) is written where the
 * draws read it (`ratios`: a word a light, then, from the middle of the buffer, the rank each light had in the view's image before plus one, 0 for none, from the view's `previousRanks`), and this image's power is kept for the next. A light just turned on has a ratio of 0, and the draw treats it as visible at once. The lights' buffer, the light functions'
 * atlas and the frame (`PowerFrame`: the eye, the pre-exposure and exposure, whether the ratios are measured, whether a power of the image before is held, whether the light functions are in the power)
 * are the only things it reads, so that it runs before the image's surfaces exist.
 */
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { DIRECT_LIGHT_WGSL } from '../direct/lightWgsl.ts'
import { lightStrengthWgsl } from '../direct/lightStrengthWgsl.ts'
import { lightFunctionReadWgsl } from '../lightFunction/readWgsl.ts'

export const POWER_DELTA_ENTRY = 'lightPowerDeltaMain'
export const POWER_DELTA_THREADS = 64
/** Where the kernel binds what it reads and writes, in group 0. */
export const POWER_BINDING = {
  frame: 0,
  lights: 1,
  atlas: 2,
  before: 3,
  now: 4,
  ratios: 5,
  exposureBefore: 6,
  previous: 7,
} as const
const b = POWER_BINDING

export const POWER_FRAME_WORDS = 12

export const powerDeltaWgsl = () =>
  wgslProgram(
    `
struct PowerFrame{eye:vec4f,pre:vec4f,flags:vec4u,}
@group(0) @binding(${b.frame}) var<uniform> pf:PowerFrame;
@group(0) @binding(${b.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${b.before}) var<storage,read> powerBefore:array<f32>;
@group(0) @binding(${b.now}) var<storage,read_write> powerNow:array<f32>;
@group(0) @binding(${b.ratios}) var<storage,read_write> ratios:array<u32>;
@group(0) @binding(${b.exposureBefore}) var<storage,read> exposureBefore:array<f32>;
@group(0) @binding(${b.previous}) var<storage,read> previousRanks:array<u32>;
@compute @workgroup_size(${POWER_DELTA_THREADS},1,1)
fn ${POWER_DELTA_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 let rank=id.x;
 if(rank>=directLights.count+directLights.simple){return;}
 // The rank the light had in this view's image before, plus one (0 for none), is handed on after the ratios, where the draws read it.
 let word=previousRanks[rank];
 ratios[arrayLength(&ratios)/2u+rank]=word;
 if(pf.flags.x==0u){
  ratios[rank]=bitcast<u32>(1.0);
  return;
 }
 let light=directLights.items[rank];
 var colour=light.colorIntensity.rgb*lightStrength(light);
 if(pf.flags.z!=0u){
  colour*=lightFunctionOf(light,select(pf.eye.xyz,light.positionRange.xyz,!isSun(light)));
 }
 var power=dot(colour,vec3f(0.3,0.59,0.11));
 if(isRect(light)){power*=2.0*length(light.shape.xyz)*2.0*light.shape.w;}
 let shares=sharesOf(light);
 power*=max(shares.x,shares.y)*pf.pre.x;
 var before=power;
 // The power the light had in the image before is read at the rank it had then; a light with none is its own before.
 let after=i32(word)-1;
 if(pf.flags.y!=0u&&after>=0&&u32(after)<arrayLength(&powerBefore)){
  let was=exposureBefore[0];
  before=powerBefore[u32(after)]*select(1.0,pf.pre.x/was,was>0.0);
 }
 ratios[rank]=bitcast<u32>(before/max(power,0.01));
 powerNow[rank]=power;
}`,
    [
      DIRECT_LIGHT_WGSL,
      lightStrengthWgsl('pf.pre.x*pf.pre.y'),
      lightFunctionReadWgsl({ group: 0, atlas: b.atlas, eye: 'pf.eye.xyz' }),
    ],
  )
