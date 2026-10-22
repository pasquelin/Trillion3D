import { HALF_MAX } from '../../../../../math/src/wgsl/constants.ts'
import { HAZE_READ_WGSL } from '../../../lighting/atmosphere/hazeReadWgsl.ts'
import { SEPARATED_READ_WGSL } from '../../../lighting/atmosphere/separatedWgsl.ts'
import { airProgram, type AirBindings } from '../../../lighting/atmosphere/programs.ts'
import {
  airShapeKey,
  DEFAULT_AIR_SHAPE,
  type AirShape,
} from '../../../lighting/atmosphere/shape.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { cloudMaterialBindings } from './materialWgsl.ts'
import { CLOUD_FORMAT, DEVICE_DEPTH_FLOOR } from './reconstructLayout.ts'
import { cloudDepthBinding, cloudSceneDepthFn } from './traceDepthWgsl.ts'
import { CLOUD_TRACE_BINDING as B, CLOUD_TRACE_LAYOUT } from './traceLayout.ts'
import { AIR_FOG_BINDINGS } from '../../../lighting/atmosphere/programs.ts'
import { fogBlockOf } from '../../../lighting/fog/readWgsl.ts'
import { CLOUD_LIGHT_WGSL } from './traceLightWgsl.ts'
import { CLOUD_GROUND_WGSL } from './traceGroundWgsl.ts'
import { CLOUD_MARCH_WGSL, CLOUD_RAY_WGSL, CLOUD_SHELL_WGSL } from './traceMarchWgsl.ts'
import { cloudTraceExtraWgsl } from './traceExtraWgsl.ts'
import { preExposedWgsl } from '../../../post/exposure/preWgsl.ts'
import { cloudTraceKeyText, type CloudTraceKey } from './traceExtraLayout.ts'

/** The tracing's own group: group 0 is the air's. */
const G = 1

/** What the tracing binds of the air, in group 0: the light buffer, the transmittance table and
 *  its sampler, the image's frame, the fog's cubemap and volume, and the volumes of the haze apart
 *  and around a capture (`SEPARATED_READ_WGSL`). */
export const CLOUD_TRACE_AIR: AirBindings = {
  air: 'read',
  transmittance: true,
  frame: true,
  fog: true,
  volumes: true,
}

/** The format of the scene's depth range, two half floats (the nearest and the farthest depth); the
 *  half-size checkerboard depth is written in its first channel. */
export const CLOUD_DEPTH_RANGE_FORMAT: GPUTextureFormat = 'rg16float'

/** The threads of a group along each axis. */
export const CLOUD_TRACE_GROUP_SIZE = 8

/** The tracing's layout, the bindings of its group and its structs. */
const traceBindings = (key: CloudTraceKey) => `${CLOUD_TRACE_LAYOUT.wgsl}
@group(${G}) @binding(${B.block}) var<uniform> cloudTrace:CloudTraceBlock;${cloudMaterialBindings(G, B.material)}
${cloudDepthBinding(G, B.depthRange, key.depth)}
@group(${G}) @binding(${B.colour}) var colourOut:texture_storage_2d<${CLOUD_FORMAT},write>;${
  key.minMaxDepth
    ? `
@group(${G}) @binding(${B.secondary}) var secondaryOut:texture_storage_2d<${CLOUD_FORMAT},write>;`
    : ''
}
@group(${G}) @binding(${B.depth}) var depthOut:texture_storage_2d<${CLOUD_FORMAT},write>;
struct CloudRay{origin:vec3f,dir:vec3f,tMin:f32,tMax:f32,tTop:vec2f,tBottom:vec2f,}
struct CloudTraced{colour:vec4f,secondary:vec4f,depth:vec4f,}
struct CloudDepth{closestCm:f32,furthestCm:f32,km:vec4f,}`

/** The luminance of a finished colour, written multiplied by the image's pre-exposure
 *  (\`cloudTrace.sky.w\`), none where the clouds are a hole in the alpha; its transmittance as it is. */
const CLOUD_LIGHT = `fn cloudLight(c:vec4f)->vec4f{return vec4f(preExposed(c.rgb)*select(1.0,0.0,cloudTrace.local.y!=0.0),c.a);}`

/** The ray of a traced texel: cut to the shell, the scene's depth and the longest march, marched,
 *  and its colours finished. */
const traceRay = (key: CloudTraceKey) => `fn cloudRayTrace(p:vec2u)->CloudTraced{
 var out:CloudTraced;
 out.colour=vec4f(0.0,0.0,0.0,1.0);
 out.secondary=vec4f(0.0,0.0,0.0,1.0);
 out.depth=vec4f(HALF_MAX);
 let ndc=cloudNdc(p);
 var r:CloudRay;
 r.origin=frame.camera.xyz;
 r.dir=normalize(cloudUnproject(ndc,0.5)-frame.eye.xyz);
 if(!cloudShell(&r)){return out;}
 if(r.tMax<=r.tMin||r.tMin>cloudTrace.reach.x){return out;}
 let depth=cloudSceneDepth(p,ndc);
 out.depth=depth.km;
 if(cloudTrace.options.z==1u){
  if(depth.furthestCm<r.tMin){return out;}
  r.tMax=min(r.tMax,depth.furthestCm);
 }
 if(!cloudMaxDistance(&r,depth.furthestCm)){return out;}
 r.tMin=max(r.tMin,cloudTrace.reach.y);
 r.tMax=max(r.tMin,r.tMax);
 let m=cloudMarch(r,${key.minMaxDepth ? 'depth.closestCm' : '-1.0'},p);
 let seenDepth=cloudMeanDepth(m.seen,r.tMax);
 out.colour=cloudLight(cloudFinish(m.seen,seenDepth,r.dir));
${
  key.minMaxDepth
    ? ' out.secondary=cloudLight(cloudFinish(m.nearest,cloudMeanDepth(m.nearest,r.tMax),r.dir));\n'
    : ''
} out.depth.x=select(seenDepth,r.tMax,out.colour.a>0.99)*CLOUD_CM_TO_KM;
 return out;
}`

/** The compute entry: one thread to a texel of the traced image. */
const traceMain = (
  key: CloudTraceKey,
) => `@compute @workgroup_size(${CLOUD_TRACE_GROUP_SIZE},${CLOUD_TRACE_GROUP_SIZE},1)
fn cloudTraceMain(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=cloudTrace.traced.x||id.y>=cloudTrace.traced.y){return;}
 cloudStart();
 cloudLampsStart(id.xy,f32(cloudTrace.mapping.y));
 let traced=cloudRayTrace(id.xy);
 textureStore(colourOut,id.xy,traced.colour);${
   key.minMaxDepth ? '\n textureStore(secondaryOut,id.xy,traced.secondary);' : ''
 }
 textureStore(depthOut,id.xy,traced.depth);}`

/**
 * THE VIEW TRACING: one thread to a texel of the traced image, a ray from the eye through the view
 * pixel the image traces this time, marched through the cloud layer's shell.
 *
 * The ray is cut to the shell, to the scene's depth, to the longest march and the nearest start,
 * and takes as many steps as its length asks (`samples`), the first of each placed by the blue
 * noise of its pixel. At each step the material (`cloudMaterialAt`) gives the extinction, the
 * colour and the emission; where the cloud scatters, the light of the air and the sky is gathered
 * (`traceLightWgsl.ts`) and integrated over the step. The march ends where every channel of what
 * the ray lets through is under the opacity limit.
 *
 * Three images are written (`reconstructLayout.ts`): the luminance and the transmittance, the same
 * for the samples before the nearest depth of the texel's block, and the depths in kilometres. The
 * haze of the air is laid over each once, at the mean distance of the cloud the ray met weighted by
 * what it let through. The fog of the scene is laid here only with the late fog off
 * (\`cloudFogLate\`); with it on, it is laid with the composition. The haze is laid here unless a
 * second pass lays it per pixel (\`options.x\`).
 *
 * The frame's options vary the program (\`traceExtraWgsl.ts\`): the empty-space table, the sun's
 * opaque shadow and the lamps. A reflection or a capture (\`options.y\`) places the first sample of
 * a ray in the middle of its step, not by the blue noise.
 *
 * Lengths are centimetres; the shell is intersected in kilometres from the planet's centre.
 */
const traceOwn = (key: CloudTraceKey) =>
  [
    traceBindings(key),
    CLOUD_SHELL_WGSL,
    cloudSceneDepthFn(key.depth),
    CLOUD_MARCH_WGSL,
    CLOUD_LIGHT,
    traceRay(key),
    traceMain(key),
  ].join('\n')

const programs = new Map<string, string>()

/** The view tracing's whole program for `key` (`CLOUD_TRACE_ENTRY`) under the air's `shape`: the
 *  scene's depth it reads, the second surface it traces or not, and the options make the program; one
 *  is made for each and kept. */
export function cloudTraceProgram(key: CloudTraceKey, shape: AirShape = DEFAULT_AIR_SHAPE) {
  const text = `${cloudTraceKeyText(key)}#${airShapeKey(shape)}`
  let code = programs.get(text)
  if (code === undefined) {
    code = airProgram(
      { ...CLOUD_TRACE_AIR, lights: key.localLights },
      traceOwn(key),
      [
        CLOUD_LIGHT_WGSL,
        CLOUD_GROUND_WGSL,
        cloudTraceExtraWgsl(key),
        fogBlockOf(AIR_FOG_BINDINGS),
        HALF_MAX,
        DEVICE_DEPTH_FLOOR,
        preExposedWgsl('cloudTrace.sky.w'),
        CLOUD_RAY_WGSL,
        HAZE_READ_WGSL,
        SEPARATED_READ_WGSL,
        blueNoiseWgsl(G, B.blueNoise),
      ],
      shape,
    ).code
    programs.set(text, code)
  }
  return code
}
export const CLOUD_TRACE_ENTRY = 'cloudTraceMain'
