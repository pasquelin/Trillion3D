import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { worldMatrix3 } from '../../../math/src/wgsl/matrix.ts'
import { runtimeRadianceWgsl } from './runtimeRadianceWgsl.ts'
import { sceneKey, type SceneBindings } from './sceneBindings.ts'
import { SURFACE_RAY_WGSL } from './surfaceRayWgsl.ts'

/**
 * THE PROBES' RAY of the proxy (`rtProbeRay`, `probeWgsl.ts`): the tint of the first surface it meets
 * lit by the lights — shadows traced against the proxy (`rtBlocked`) — and the bounce (`surfaceLit`,
 * `rtLit`), what the cascades are made of, and the distance to it. The reflections read a hit's
 * radiance instead (`rtSeen`, `runtimeRadianceWgsl.ts`): only the probes light a hit light by light.
 */
export const runtimeProbeRayWgsl = (scene: SceneBindings) =>
  wgslBlock(
    `runtimeProbeRayWgsl(${sceneKey(scene)})`,
    [runtimeRadianceWgsl(scene), SURFACE_RAY_WGSL, worldMatrix3],
    `/** The light a probe's hit returns: its tint lit at the point by the lights and the bounce
 *  (\`surfaceLit\`) — what the cascades are made of. */
fn rtLit(hit:RtHit,origin:vec3f,direction:vec3f,surface:RtSurface,reach:f32,world:mat3x3f)->vec3f{
 return surfaceLit(surface.tint,origin+direction*hit.distance,rtFacing(hit,direction,world),reach);
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
}`,
  )
