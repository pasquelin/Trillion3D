import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { wgslBlock, wgslStruct } from '../../../math/src/wgsl/decl.ts'
import { SURFACE_RAY_WGSL } from './surfaceRayWgsl.ts'
import { inverseTranspose3, unitOrZero } from '../../../math/src/wgsl/inverseTranspose.ts'
import { faceNormal } from '../../../math/src/wgsl/geometry.ts'
import { worldMatrix3 } from '../../../math/src/wgsl/matrix.ts'
import { runtimeSceneWgsl } from './runtimeSceneWgsl.ts'
import { sceneKey, type SceneBindings } from './sceneBindings.ts'
import {
  RAY_ERROR_FLOOR,
  RAY_LAYERS,
  RAY_SPREAD_FLOOR,
  RAY_THROUGH_FLOOR,
  SURFACE,
  SURFACE_BLENDED,
  SURFACE_WORDS,
} from './runtimeLayout.ts'

/** What a stage of a ray's answer brings back: the radiance of what it met, the confidence of the
 *  answer, and the distance to what answered — the screen's, the proxy's, one struct. */
export const RADIANCE_ANSWER = wgslStruct(
  'RadianceAnswer',
  [],
  'struct RadianceAnswer{color:vec3f,confidence:f32,distance:f32,}',
)

/**
 * THE RADIANCE OF A RAY: what a ray of the proxy (`runtimeSceneWgsl.ts`) brings back. `rtRadiance` is the
 * radiance through up to `RAY_LAYERS` surfaces — a blended one lets the rest of the light through (its opacity
 * weighs its own radiance, the transmittance goes on) —, and the confidence of the answer: what it holds, the
 * rest left to the next stage, and the distance to the first surface it met. The radiance of a surface is
 * its emission and its diffuse tint under the irradiance the cascades hold (`surfaceSeen`): read, its cost
 * the same whatever the lights. A mesh whose placement deforms is traced at its rest shape, its confidence
 * cut by the placement's reach against the footprint. `rtProbeRay` is the probes' ray: the tint of the first
 * surface lit by the lights — shadows traced against the proxy (`rtBlocked`) — and the bounce
 * (`surfaceLit`), what the cascades are made of, and the distance to it.
 */
export const runtimeRadianceWgsl = (scene: SceneBindings) =>
  wgslBlock(
    `runtimeRadianceWgsl(${sceneKey(scene)})`,
    [
      RADIANCE_ANSWER,
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
const RT_SPREAD_FLOOR:f32=${wgslF32(RAY_SPREAD_FLOOR)};
const RT_THROUGH_FLOOR:f32=${wgslF32(RAY_THROUGH_FLOOR)};
const RT_ERROR_FLOOR:f32=${wgslF32(RAY_ERROR_FLOOR)};
/** A surface's words (\`runtimeLayout.ts\`): its diffuse tint and opacity, its emission and its flags. */
struct RtSurface{tint:vec3f,opacity:f32,emission:vec3f,blended:bool,}
fn rtSurfaceOf(index:u32)->RtSurface{
 let base=rtProxy.surfacesWord+index*RT_SURFACE_WORDS;
 return RtSurface(
  rtVec(base+RT_SURFACE_TINT),rtFloat(base+RT_SURFACE_OPACITY),
  rtVec(base+RT_SURFACE_EMISSION),
  (rtProxy.words[base+RT_SURFACE_FLAGS]&RT_SURFACE_BLENDED)!=0u);
}
/** The normal of a hit's face that looks at the ray along \`direction\`. \`world\`: the linear part of
 *  the hit placement's world, which the caller read once. */
fn rtFacing(hit:RtHit,direction:vec3f,world:mat3x3f)->vec3f{
 let n=faceNormal(rtVertex(hit.triangle,0u),rtVertex(hit.triangle,1u),rtVertex(hit.triangle,2u));
 let N=unitOrZero(inverseTranspose3(world,n));
 return select(N,-N,dot(N,direction)>0.0);
}
/** The light a probe's hit returns: its tint lit at the point by the lights and the bounce
 *  (\`surfaceLit\`) — what the cascades are made of. */
fn rtLit(hit:RtHit,origin:vec3f,direction:vec3f,surface:RtSurface,reach:f32,world:mat3x3f)->vec3f{
 return surfaceLit(surface.tint,origin+direction*hit.distance,rtFacing(hit,direction,world),reach);
}
/** The radiance a reflection's hit brings back, read, never lit a light at a time: what it emits, and
 *  its tint under the irradiance the cascades already hold there (\`surfaceSeen\`) — the cost of a hit
 *  the same whatever the lights. */
fn rtSeen(hit:RtHit,origin:vec3f,direction:vec3f,surface:RtSurface,world:mat3x3f)->vec3f{
 let N=rtFacing(hit,direction,world);
 return surface.emission+surfaceSeen(surface.tint,origin+direction*hit.distance,N);
}
/**
 * The run-time proxy's answer to a ray of length \`reach\` from \`origin\`: its first surface, and
 * the ones behind it while the surfaces met let light through, up to \`RT_LAYERS\`. The answer is the
 * radiance of the light they hold, \`confidence\` the share of the ray they stop; the rest goes on to the
 * next stage, \`distance\` the first surface's, \`reach\` where none. \`error\` is the width the ray's lobe covers at a metre, \`tangent\`: a deformed placement's
 * reach, which its rest shape does not hold, takes confidence from a hit narrower than it.
 * A hit's radiance is read (\`rtSeen\`): no light is evaluated and no shadow ray cast for it. Exhausted
 * — its \`budget\` of units spent, \`RT_WORK\` at most — is no answer at all, confidence zero
 * (\`runtimeLayout.ts\`).
 */
fn rtRadiance(origin:vec3f,direction:vec3f,reach:f32,tangent:f32,budget:u32)->RadianceAnswer{
 rtBegin();
 rtBudget=min(budget,RT_WORK);
 var first=reach;
 var color=vec3f(0.0);
 var through=1.0;
 var start=origin;
 var left=reach;
 for(var layer=0u;layer<RT_LAYERS;layer++){
  let hit=rtScene(start,direction,left);
  if(rtSpent()){return RadianceAnswer(vec3f(0.0),0.0,first);}
  if(!hit.found){break;}
  if(layer==0u){first=hit.distance;}
  let instance=rtWorldsInstance(hit.placement,0u);
  let surface=rtSurfaceOf(instance[RT_INSTANCE_SURFACE]);
  let spread=hit.distance*tangent+RT_SPREAD_FLOOR;
  let marked=unpack2x16float(instance[RT_INSTANCE_MARK]>>16u).x;
  let world=worldMatrix3(rtWorldOf(hit.placement));
  let known=spread/(spread+marked*length(world[0]));
  let opacity=select(1.0,surface.opacity,surface.blended)*known;
  color+=through*opacity*rtSeen(hit,start,direction,surface,world);
  through*=1.0-opacity;
  let travelled=hit.distance+max(rtProxy.error,RT_ERROR_FLOOR);
  start+=direction*travelled;
  left-=travelled;
  if(through<RT_THROUGH_FLOOR||left<=0.0){break;}
 }
 let held=1.0-through;
 return RadianceAnswer(select(vec3f(0.0),color/held,held>0.0),held,first);
}

/** The light a probe's ray brings back: from \`origin\` along \`direction\`, \`reach\` far, what the first surface it
 *  meets is lit to — its emission is not bounced, the lamp lights the room directly — and the distance travelled,
 *  \`reach\` where it meets nothing. An exhausted ray carries zero weight (\`runtimeLayout.ts\`): its distance is
 *  then negative, and the probe leaves it out of its estimate. */
fn rtProbeRay(origin:vec3f,direction:vec3f,reach:f32)->vec4f{
 rtBegin();
 let hit=rtScene(origin,direction,reach);
 if(rtSpent()){return vec4f(0.0,0.0,0.0,-1.0);}
 if(!hit.found){return vec4f(0.0,0.0,0.0,reach);}
 let surface=rtSurfaceOf(rtWorldsInstance(hit.placement,0u)[RT_INSTANCE_SURFACE]);
 let lit=rtLit(hit,origin,direction,surface,reach,worldMatrix3(rtWorldOf(hit.placement)));
 if(rtLost){return vec4f(0.0,0.0,0.0,-1.0);}
 return vec4f(lit,hit.distance);
}
`,
  )
