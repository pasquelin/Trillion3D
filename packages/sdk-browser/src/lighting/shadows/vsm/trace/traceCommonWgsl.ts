/**
 * THE SHADOW RAYS' COMMON PIECES (`traceWgsl.ts`), every light's: the march's sample times, the
 * square-to-disk maps (a sun's exact, a local light's approximate) and the cone a ray is drawn in,
 * each ray's step jitter and blue-noise values, and a trace's result. No binding but the noise pair the host gives (`vsmRayNoiseWgsl`).
 */
import { BLUE_NOISE_TILE } from '../../../../gpu/noise/blueNoiseWgsl.ts'
import { type WgslDecl, wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import {
  additive2d,
  approxDiskMap,
  uniformDiskConcentric,
} from '../../../../../../math/src/wgsl/sampling.ts'
import { Frame3, outOfFrame } from '../../../../../../math/src/wgsl/basis.ts'

export const VSM_TRACE_COMMON_WGSL = wgslBlock(
  'VSM_TRACE_COMMON_WGSL',
  [Frame3, outOfFrame, approxDiskMap, uniformDiskConcentric],
  `
/** The march's sample times: t² with t = a·i + b (the two words returned, a = −1/stepCount), from
 *  the far end (i = 0) to the ray's start (i = stepCount, time 0), each step jittered by \`stepJitter\`. */
fn vsmMarchTimeLine(stepCount:i32,stepJitter:f32)->vec2f{
 let timeScale=-1.0/f32(stepCount);
 return vec2f(timeScale,1.0+(1.0-stepJitter)*timeScale);
}
fn vsmMarchTime(i:i32,stepCount:i32,time:vec2f)->f32{
 if(i==stepCount){return 0.0;}
 let t=time.x*f32(i)+time.y;
 return t*t;
}
/** The unit-disk point of a ray's noise \`E\`: a sun's exact map (\`uniformDiskConcentric\`), a local light's
 *  approximate one (\`approxDiskMap\`); only the one map runs. */
fn vsmLightDisk(directional:bool,E:vec2f)->vec2f{
 if(directional){return uniformDiskConcentric(E);}
 return approxDiskMap(E);
}
/** A ray toward a point of the light's disk as the receiver sees it: inside the cone of sine \`s\`
 *  around the frame's axis \`basis.z\`, the unit-disk point \`disk\` (\`vsmLightDisk\`) its sine across the
 *  axis — a sun's angular radius and a local light's emitter alike. The unit direction and the
 *  cone's own cosine \`cosTheta\` (the ray's angle off the axis): a dot product of the normalised
 *  direction could round past 1. */
struct VsmConeRay{dir:vec3f,cosTheta:f32,}
fn vsmConeDirection(basis:Frame3,s:f32,disk:vec2f)->VsmConeRay{
 let across=disk*s;
 let cosTheta=sqrt(max(0.0,1.0-dot(across,across)));
 return VsmConeRay(outOfFrame(vec3f(across,cosTheta),basis),cosTheta);
}
`,
)

/** The rays' four random values a ray (`vsmRayNoise4`), from the noise pair `noise` provides
 *  (`blueNoiseVec2`): the disk point (xy) and the start's dither (zw). */
export const vsmRayNoiseWgsl = (noise: WgslDecl) =>
  wgslBlock(
    'vsmRayNoiseWgsl',
    [BLUE_NOISE_TILE, additive2d, noise],
    `
/** Four blue-noise values for a pixel, ray and frame: two reads of the blue-noise texture, offset by
 *  the additive sequence. */
fn vsmRayNoise4(pixelPos:vec2u,timeIndex:u32,rayIndex:u32,rayTotal:u32)->vec4f{
 let dims=vec2f(BLUE_NOISE_TILE.xy);
 let offset1=vec2i(additive2d(vec2f(0.0),rayIndex)*dims);
 let offset2=vec2i(additive2d(vec2f(0.0),rayIndex+rayTotal)*dims);
 return vec4f(blueNoiseVec2(pixelPos+bitcast<vec2u>(offset1),timeIndex),blueNoiseVec2(pixelPos+bitcast<vec2u>(offset2),timeIndex));
}
`,
  )

/** What a trace returns: the share of its rays that missed, and how many it traced — none, its
 *  factor 1, where it traced no ray (`vsmEmptyTrace`). */
export const VSM_TRACE_RESULT_WGSL = wgslBlock(
  'VSM_TRACE_RESULT_WGSL',
  [],
  `
struct VsmTraceResult{shadowFactor:f32,rayCount:u32,occluderDistance:f32,}
fn vsmEmptyTrace()->VsmTraceResult{return VsmTraceResult(1.0,0u,-1.0);}
`,
)

/**
 * A light's ray count (the adaptive ray count), decided over a 32-pixel half:
 * - after the first ray, a half all of whose lanes missed stops (`vsmVoteAllTrue`);
 * - at the adaptive count, a half all of whose lanes' rays hit so far (an umbra) stops. Asking at
 *   every ray from there on would change nothing; it is asked there alone: a half it does not stop holds a lane that
 *   missed, which votes no at every later ray (`missed` never loses a ray) and is never stopped, so a
 *   later vote could stop no lane.
 * The group leaves the loop where both halves stopped (`vsmGroupVoted`): every lane idle, the
 * rays left trace nothing. A half stops at the first vote or the umbra one only, so the group
 * asks there, unless the loop ends anyway (`../projection/projectionGroupExit.test.ts`). The votes
 * barrier the group, so they are reached in uniform flow: `votes` and `rayCap` are the kind's, not the
 * lane's light's, and no vote is the right side of a `&&` or `||`.
 *
 * A fragment's trace (`lone`): a sun's traces every ray, its vote kept to the compute projection's
 * groups; a local light's votes over its subgroup's active lanes where the device grants subgroups
 * (`subgroupAllTrue`, `SUBGROUP_ALL_WGSL`, which the module lists), and without subgroups traces
 * every ray: a lane voting on its own value would stop alone. Every lane voting gets one answer, so
 * the lanes a stop holds leave the loop together.
 */
export const rayCountStatement = (lone: boolean, subgroups: boolean) =>
  lone
    ? subgroups
      ? /* wgsl */ `  if(!directional&&vsm.adaptiveRayCount>0u&&(i==0u||i==vsm.adaptiveRayCount)){
   if(subgroupAllTrue(!running||select(missed==0u,!hit,i==0u))){if(running){stopped=true;stopIndex=i;}break;}
  }
`
      : ''
    : /* wgsl */ `  var halfStops=false;
  let votes=vsm.adaptiveRayCount>0u&&(i==0u||i==vsm.adaptiveRayCount);
  if(votes){
   if(i==0u){halfStops=vsmVoteAllTrue(!running||!hit);}
   else{halfStops=vsmVoteAllTrue(!running||missed==0u);}
  }
  if(halfStops&&running){stopped=true;stopIndex=i;}
  if(votes&&i+1u<rayCap){if(vsmGroupVoted(halfStops)){break;}}
`
