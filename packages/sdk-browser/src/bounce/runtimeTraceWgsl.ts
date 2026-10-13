import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { SURFACE_RAY_WGSL } from './surfaceRayWgsl.ts'
import { inverseTranspose3, unitOrZero } from '../../../math/src/wgsl/inverseTranspose.ts'
import { faceNormal } from '../../../math/src/wgsl/geometry.ts'
import { worldMatrix3 } from '../../../math/src/wgsl/matrix.ts'
import { RUNTIME_ANSWER_WGSL } from './runtimeAnswerWgsl.ts'
import { runtimeSceneWgsl, type SceneBindings } from './runtimeSceneWgsl.ts'
import {
  FRAME_WORK,
  RAY_LAYERS,
  STORE_BITS,
  SURFACE,
  SURFACE_BLENDED,
  SURFACE_WORDS,
  TRACE_LIST,
} from './runtimeLayout.ts'

/**
 * THE RADIANCE OF A RAY: what a ray of the proxy (`runtimeSceneWgsl.ts`) brings back. `rtRadiance` is the
 * radiance through up to `RAY_LAYERS` surfaces — a blended one lets the rest of the light through (its opacity
 * weighs its own radiance, the transmittance goes on) —, and the confidence of the answer: what it holds, the
 * rest left to the next stage. The radiance of a surface is its emission and its diffuse tint lit as the proxy's
 * other surfaces are (`surfaceLit`), the shadows traced against the proxy itself (`rtBlocked`). A mesh whose
 * placement deforms is traced at its rest shape, its confidence cut by the placement's reach against the
 * footprint. `rtProbeRay` is the probes' ray: the lit tint of the first surface and the distance to it.
 */
export const runtimeRadianceWgsl = (scene: SceneBindings) =>
  wgslBlock(
    `runtimeRadianceWgsl(${scene.group}, ${scene.proxy})`,
    [
      runtimeSceneWgsl(scene),
      SURFACE_RAY_WGSL,
      inverseTranspose3,
      unitOrZero,
      faceNormal,
      worldMatrix3,
    ],
    `
${wgslConsts({
  RT_LAYERS: RAY_LAYERS,
  RT_SURFACE_BLENDED: SURFACE_BLENDED,
  RT_SURFACE_WORDS: SURFACE_WORDS,
  RT_SURFACE_TINT: SURFACE.tint,
  RT_SURFACE_OPACITY: SURFACE.opacity,
  RT_SURFACE_EMISSION: SURFACE.emission,
  RT_SURFACE_FLAGS: SURFACE.flags,
})}
/** What a ray brings back: the radiance of what it met, weighed by the confidence of the answer. */
struct RtRadiance{color:vec3f,confidence:f32,}
/** A surface's words (\`runtimeLayout.ts\`): its diffuse tint and opacity, its emission and its flags. */
struct RtSurface{tint:vec3f,opacity:f32,emission:vec3f,blended:bool,}
fn rtSurfaceVec(at:u32)->vec3f{return vec3f(rtFloat(at),rtFloat(at+1u),rtFloat(at+2u));}
fn rtSurfaceOf(index:u32)->RtSurface{
 let base=rtProxy.surfacesWord+index*RT_SURFACE_WORDS;
 return RtSurface(
  rtSurfaceVec(base+RT_SURFACE_TINT),rtFloat(base+RT_SURFACE_OPACITY),
  rtSurfaceVec(base+RT_SURFACE_EMISSION),
  (rtProxy.words[base+RT_SURFACE_FLAGS]&RT_SURFACE_BLENDED)!=0u);
}
/** The light a hit's surface returns, seen from \`direction\`: its tint lit at the point by the lights
 *  (\`surfaceLit\`), on the face that looks at the ray. */
fn rtLit(hit:RtHit,origin:vec3f,direction:vec3f,surface:RtSurface,reach:f32)->vec3f{
 let n=faceNormal(rtVertex(hit.triangle,0u),rtVertex(hit.triangle,1u),rtVertex(hit.triangle,2u));
 var N=unitOrZero(inverseTranspose3(worldMatrix3(rtWorldOf(hit.placement)),n));
 if(dot(N,direction)>0.0){N=-N;}
 return surfaceLit(surface.tint,origin+direction*hit.distance,N,reach);
}
/** The radiance a hit brings back: what it emits, and what it is lit to. */
fn rtShade(hit:RtHit,origin:vec3f,direction:vec3f,surface:RtSurface,reach:f32)->vec3f{
 return surface.emission+rtLit(hit,origin,direction,surface,reach);
}
/**
 * The run-time proxy's answer to a ray of length \`reach\` from \`origin\`: its first surface, and
 * the ones behind it while the surfaces met let light through, up to \`RT_LAYERS\`. The answer is the
 * radiance of the light they hold, \`confidence\` the share of the ray they stop; the rest goes on to the
 * next stage. \`error\` is the width the ray's lobe covers at a metre, \`tangent\`: a deformed placement's
 * reach, which its rest shape does not hold, takes confidence from a hit narrower than it.
 * Exhausted — its budget or a shadow ray's spent — is no answer at all, confidence zero
 * (\`runtimeLayout.ts\`).
 */
fn rtRadiance(origin:vec3f,direction:vec3f,reach:f32,tangent:f32)->RtRadiance{
 rtWork=0u;
 rtTests=0u;
 rtExtra=0u;
 rtLost=false;
 var color=vec3f(0.0);
 var through=1.0;
 var start=origin;
 var left=reach;
 for(var layer=0u;layer<RT_LAYERS;layer++){
  let hit=rtScene(start,direction,left);
  if(rtSpent()){return RtRadiance(vec3f(0.0),0.0);}
  if(!hit.found){break;}
  let surface=rtSurfaceOf(rtInstanceWord(hit.placement,RT_INSTANCE_SURFACE));
  let spread=hit.distance*tangent+0.01;
  let marked=unpack2x16float(rtInstanceWord(hit.placement,RT_INSTANCE_MARK)>>16u).x;
  let known=spread/(spread+marked*length(rtWorldOf(hit.placement)[0].xyz));
  let opacity=select(1.0,surface.opacity,surface.blended)*known;
  color+=through*opacity*rtShade(hit,start,direction,surface,reach);
  if(rtLost){return RtRadiance(vec3f(0.0),0.0);}
  through*=1.0-opacity;
  let travelled=hit.distance+max(rtProxy.error,1e-3);
  start+=direction*travelled;
  left-=travelled;
  if(through<0.02||left<=0.0){break;}
 }
 let held=1.0-through;
 return RtRadiance(select(vec3f(0.0),color/held,held>0.0),held);
}

/** The light a probe's ray brings back: from \`origin\` along \`direction\`, \`reach\` far, what the first surface it
 *  meets is lit to — its emission is not bounced, the lamp lights the room directly — and the distance travelled,
 *  \`reach\` where it meets nothing. An exhausted ray carries zero weight (\`runtimeLayout.ts\`): its distance is
 *  then negative, and the probe leaves it out of its estimate. */
fn rtProbeRay(origin:vec3f,direction:vec3f,reach:f32)->vec4f{
 rtWork=0u;
 rtTests=0u;
 rtExtra=0u;
 rtLost=false;
 let hit=rtScene(origin,direction,reach);
 if(rtSpent()){return vec4f(0.0,0.0,0.0,-1.0);}
 if(!hit.found){return vec4f(0.0,0.0,0.0,reach);}
 let surface=rtSurfaceOf(rtInstanceWord(hit.placement,RT_INSTANCE_SURFACE));
 let lit=rtLit(hit,origin,direction,surface,reach);
 if(rtLost){return vec4f(0.0,0.0,0.0,-1.0);}
 return vec4f(lit,hit.distance);
}
`,
  )

/** The bindings of the program that answers a pixel from the store: the proxy's, the trace's list with the
 *  frame's counters and the store of the answers (`runtimeLayout.ts`). */
export type RuntimeBindings = SceneBindings & { list: number; store: number }

/**
 * THE RUN-TIME PROXY'S ANSWERS TO A TRACE: the radiance above, kept from image to image in the store
 * (`runtimeAnswerWgsl.ts`).
 */
export const runtimeTraceWgsl = ({ list, store, ...scene }: RuntimeBindings) =>
  wgslBlock(
    `runtimeTraceWgsl(${scene.group}, ${scene.proxy}, ${list}, ${store})`,
    [runtimeRadianceWgsl(scene), RUNTIME_ANSWER_WGSL],
    `
${wgslConsts({
  RT_FRAME_WORK: FRAME_WORK,
  RT_LEFT: TRACE_LIST.left,
  RT_SPENT: TRACE_LIST.spent,
  RT_OFFSET: TRACE_LIST.offset,
  RT_CURSOR: TRACE_LIST.cursor,
  RT_CONFIDENCE_MAX: 2 ** STORE_BITS.confidence - 1,
  RT_STAMP_SHIFT: STORE_BITS.stamp,
})}
@group(${scene.group}) @binding(${list}) var<storage,read_write> rtList:array<atomic<u32>>;
@group(${scene.group}) @binding(${store}) var rtStore:texture_storage_2d_array<r32uint,read_write>;
/** The pixel the trace is at, and the rays it has asked of the proxy for it: the first is the base
 *  lobe's, which keeps its answer in the store (\`rtAnswer\`); a coat's goes without. */
var<private> rtPixel:vec2u;
var<private> rtRank:u32;
var<private> rtCalls:u32;
`,
  )
