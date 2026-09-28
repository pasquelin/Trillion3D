import { mirrorLightingShader, mirrorWeightShader } from '../reflections/modelShader.ts';
export { MIRROR_TRANSITION_END } from '../reflections/modelShader.ts';

/** Rank of the surface cache in the deferred bounce layout: past the water composite's own
 *  bindings (14 to 17) and the shadow transmittance pair (18, 19), which share those numbers. */
export const BOUNCE_SURFACE_BINDING = 20;

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
 * radiance arriving at P along R from a lobe of the given roughness. At the roughness floor the
 * lobe is the mirror direction itself: the ray is traced against the resident proxy and reads the
 * face it hits in the surface cache — the reflected geometry, at the proxy's certified error, lit
 * by the same direct and bounce the probes gather. A rougher lobe, or a ray that leaves the proxy,
 * reads the probe irradiance in R over π: the blurred far field, never a sharp image through a
 * rough surface (rough reflections are #33). One LTC roughness interval blends the proxy into
 * that fallback above the floor, preserving full mirror energy at and below it. This numerical
 * transition is not a filtered rough lobe; changing the table resolution changes its width.
 * Without bounce there is no cache and no probe:
 * exactly zero, and no ray is fired.
 *
 * The ray starts where the sun's far shadow starts (`sunFarShadowWgsl`): lifted off the plane, one
 * proxy cell along its own direction, so the coarse surface the point sits on does not reflect
 * itself. Needs the proxy traversal, the probe grid and `INVERSE_PI` in the same module.
 */
export const bounceReflectionWgsl = (binding: number) => `
@group(0) @binding(${binding}) var<storage,read> surface:array<vec4f>;
${SURFACE_RAY_WGSL}
${mirrorWeightShader('wgsl')}
fn reflectedRadiance(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec3f{
 if(bounce.counts.w==0u){return vec3f(0.0);}
 let weight=mirrorWeight(rough);
 if(weight>0.0){
  let reach=bounce.reach.x;
  let hit=rayRadiance(P+N*proxy.offsetMetres+R*proxy.startMetres,R,reach);
  if(hit.w<reach){
   if(weight==1.0){return hit.rgb;}
   return mix(sampleBounce(P,R)*INVERSE_PI,hit.rgb,weight);
  }
 }
 return sampleBounce(P,R)*INVERSE_PI;
}`;

/**
 * The specular a smooth opaque surface returns from what it reflects (#31): the radiance along the
 * mirror direction, weighed by the GGX lobe's directional albedo the rectangular light already
 * reads (\`ltcLookup\`, texel 1: magnitude and Schlick share) — the split-sum's second factor.
 *
 * The delta-direction contribution has full weight at the mirror limit and fades once over one
 * LTC roughness sample above it. Read at the floor so the shared water transition does not
 * also attenuate the proxy contribution inside this fade.
 * Beyond that interval a rougher lobe needs filtered radiance (#33); the term stays zero.
 * A diffuse or toon surface has no specular lobe and reflects nothing.
 */
export const MIRROR_LIGHTING_WGSL = mirrorLightingShader('wgsl');
