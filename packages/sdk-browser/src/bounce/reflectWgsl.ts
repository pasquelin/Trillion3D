import { MODEL_FLAG } from '../scene/surfaceModel.ts';
import { ROUGHNESS_FLOOR } from '../lighting/shaderConstants.ts';

/** Rank of the surface cache in the deferred bounce layout: past the water composite's own
 *  bindings (14 to 17), which extend that layout at the same numbers. */
export const BOUNCE_SURFACE_BINDING = 18;

/**
 * Radiance a ray brings back from the resident proxy: nothing if it hits nothing, the hit texel
 * otherwise. It is a read, not a compute: the surface cache already holds the outgoing radiance of
 * that face. The probes gather it and a reflection reads it, from this one text, against the
 * `surface` array each caller binds.
 */
export const SURFACE_RAY_WGSL = `
fn rayRadiance(origin:vec3f,direction:vec3f,reach:f32)->vec4f{
 let hit=traceProxy(origin,direction,reach);
 if(!hit.found){return vec4f(0.0,0.0,0.0,reach);}
 // The face that counts is the one looking at the ray: the proxy is two-sided by construction.
 let face=select(0u,1u,dot(proxyNormal(hit.triangle),direction)>0.0);
 let texel=hit.triangle*2u+face;
 if(texel>=arrayLength(&surface)){return vec4f(0.0,0.0,0.0,hit.distance);}
 return vec4f(surface[texel].rgb,hit.distance);
}`;

/**
 * The engine's one reflection model, at the binding the calling pass gives the surface cache: the
 * radiance arriving at P along R. The ray is traced against the resident proxy and reads the face
 * it hits in the surface cache — the reflected geometry, at the proxy's certified error, lit by the
 * same direct and bounce the probes gather. A ray that leaves the proxy reads the probe irradiance
 * in R over π, the far field the water reflected alone before. Without bounce there is no cache
 * and no probe: exactly zero, and no ray is fired.
 *
 * The ray starts where the sun's far shadow starts (`sunFarShadowWgsl`): lifted off the plane, one
 * proxy cell along its own direction, so the coarse surface the point sits on does not reflect
 * itself. Needs the proxy traversal, the probe grid and `INVERSE_PI` in the same module.
 */
export const bounceReflectionWgsl = (binding: number) => `
@group(0) @binding(${binding}) var<storage,read> surface:array<vec4f>;
${SURFACE_RAY_WGSL}
fn reflectedRadiance(P:vec3f,N:vec3f,R:vec3f)->vec3f{
 if(bounce.counts.w==0u){return vec3f(0.0);}
 let reach=bounce.reach.x;
 let hit=rayRadiance(P+N*proxy.offsetMetres+R*proxy.startMetres,R,reach);
 if(hit.w<reach){return hit.rgb;}
 return sampleBounce(P,R)*INVERSE_PI;
}`;

/**
 * The specular a smooth opaque surface returns from what it reflects (#31): the radiance along the
 * mirror direction, weighed by the GGX lobe's directional albedo the rectangular light already
 * reads (\`ltcLookup\`, texel 1: magnitude and Schlick share) — the split-sum's second factor.
 *
 * Only at the mirror limit: a roughness at the engine's floor, where the lobe is the mirror
 * direction itself and one ray is its exact radiance. A rougher lobe needs its radiance filtered
 * over the lobe, which is #33; there the term is exactly zero and the pixel is shaded as before.
 * A diffuse or toon surface has no specular lobe and reflects nothing.
 */
export const MIRROR_LIGHTING_WGSL = `
fn mirrorLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f)->vec3f{
 if(rough>${ROUGHNESS_FLOOR}||surfaceModel==${MODEL_FLAG.diffuse}u||surfaceModel==${MODEL_FLAG.toon}u){return vec3f(0.0);}
 let t=ltcLookup(rough,clamp(dot(N,V),1e-4,1.0),1u);
 let f0=mix(vec3f(0.04),rgb,metal);
 return (f0*t.x+(vec3f(1.0)-f0)*t.y)*reflectedRadiance(P,N,reflect(-V,N));
}`;
