/**
 * THE SHADOW RAYS' COMMON PIECES (`traceWgsl.ts`), every light's: what a march returns, its sample
 * times, the square-to-disk map and the cone a ray is drawn in, each ray's step jitter and blue-noise
 * values, and a trace's result. No binding but the noise pair the host gives (`vsmRayNoiseWgsl`).
 */
import { VSM_NOISE_TILE } from './blueNoise.ts'
import { VSM_F32_BELOW_ONE } from './constants.ts'
import { type WgslDecl, wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { FLOAT32_MIN_NORMAL, QUARTER_PI } from '../../../math/src/wgsl/constants.ts'
import { additive2d } from '../../../math/src/wgsl/sampling.ts'
import { Frame3, outOfFrame } from '../../../math/src/wgsl/basis.ts'

export const VSM_TRACE_COMMON_WGSL = wgslBlock(
  'VSM_TRACE_COMMON_WGSL',
  [QUARTER_PI, FLOAT32_MIN_NORMAL, Frame3, outOfFrame, additive2d],
  `
/** A march's result: whether it hit and the ray time of the sample that hit (0 at the ray's start,
 *  1 at its far end). */
struct VsmMarchHit{hitFound:bool,hitTime:f32,}
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
/** Maps the unit square onto the unit disk, each square ring onto a circle: the unit direction
 *  and the radius (the ring). The ring is the larger coordinate; the angle runs over the eighth of
 *  the circle the smaller one's share sets, turned a quarter where y is the larger, and the
 *  direction takes the quadrant of the point's signs. Area-preserving: a uniform square point is a
 *  uniform disk point. */
fn vsmSquareToDiskPolar(E:vec2f)->vec3f{
 // 1 − 2^-24, the greatest f32 below 1, as its decimal.
 let p=2.0*E-${VSM_F32_BELOW_ONE};
 let a=abs(p);
 let lo=min(a.x,a.y);
 let hi=max(a.x,a.y);
 // The smallest normal f32 added to a nonzero |p| (2^-25 at least, for E in [0, 1)) rounds back
 // to it, so it changes no quotient, and the square's centre gives 0 rather than 0/0.
 let phi=QUARTER_PI*(lo/(hi+FLOAT32_MIN_NORMAL)+select(0.0,2.0,a.y>=a.x));
 let quadrant=select(vec2f(-1.0),vec2f(1.0),p>=vec2f(0.0));
 return vec3f(abs(vec2f(cos(phi),sin(phi)))*quadrant,hi);
}
/** A uniform point on the unit disk: the square's point taken ring to circle. */
fn vsmSquareToDisk(E:vec2f)->vec2f{let r=vsmSquareToDiskPolar(E);return r.xy*r.z;}
/** A ray direction toward a uniform point of the light's disk as the receiver sees it: inside the
 *  cone of sine \`s\` around the frame's axis \`basis.z\`, the disk point \`E\` (\`vsmSquareToDisk\`) its
 *  sine across the axis — a sun's angular radius and a local light's emitter alike. Unit length. */
fn vsmConeDirection(basis:Frame3,s:f32,E:vec2f)->vec3f{
 let across=vsmSquareToDisk(E)*s;
 return outOfFrame(vec3f(across,sqrt(max(0.0,1.0-dot(across,across)))),basis);
}
/** Ray \`i\`'s step jitter: the pixel's blue noise turned by the engine's additive sequence, ray 0
 *  the noise itself; the rays of a pixel sample their segments at times spread over the step. */
fn vsmRayJitter(noise:f32,i:u32)->f32{return additive2d(vec2f(noise),i).x;}
`,
)

/** The rays' four random values a ray (`vsmRayNoise4`), from the noise pair `noise` provides
 *  (`vsmNoiseTwo`): the disk point (xy) and the start's dither (zw). */
export const vsmRayNoiseWgsl = (noise: WgslDecl) =>
  wgslBlock(
    'vsmRayNoiseWgsl',
    [VSM_NOISE_TILE, additive2d, noise],
    `
/** Four blue-noise values for a pixel, ray and frame: two reads of the blue-noise texture, offset by
 *  the additive sequence. */
fn vsmRayNoise4(pixelPos:vec2u,timeIndex:u32,rayIndex:u32,rayTotal:u32)->vec4f{
 let dims=vec2f(VSM_NOISE_TILE.xy);
 let offset1=vec2i(additive2d(vec2f(0.0),rayIndex)*dims);
 let offset2=vec2i(additive2d(vec2f(0.0),rayIndex+rayTotal)*dims);
 return vec4f(vsmNoiseTwo(pixelPos+bitcast<vec2u>(offset1),timeIndex),vsmNoiseTwo(pixelPos+bitcast<vec2u>(offset2),timeIndex));
}
`,
  )

/** What a trace returns: the share of its rays that missed, and how many it traced — none, its
 *  factor 1, where it traced no ray (`vsmEmptyTrace`). */
export const VSM_TRACE_RESULT_WGSL = wgslBlock(
  'VSM_TRACE_RESULT_WGSL',
  [],
  `
struct VsmTraceResult{shadowFactor:f32,rayCount:u32,}
fn vsmEmptyTrace()->VsmTraceResult{return VsmTraceResult(1.0,0u);}
`,
)
