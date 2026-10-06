import {
  ENVIRONMENT_REFLECTION_WGSL,
  PROBE_REFLECTION_FILTER_WGSL,
} from '../reflections/probeFilterWgsl.ts'
import { SURFACE_IRRADIANCE_WGSL } from './irradianceWgsl.ts'
import { mirrorLightingShader, mirrorWeightShader } from '../reflections/modelShader.ts'
import { MODEL_FLAG } from '../scene/surfaceModel.ts'
import { BOUNCE_FIELDS_WGSL } from './gridWgsl.ts'

/** Rank of the surface cache in the deferred bounce layout: past the water composite's own
 *  bindings (14 to 17) and the shadow transmittance pair (18, 19), which share those numbers. */
export const BOUNCE_SURFACE_BINDING = 20

/** Posed hits read the surface cache, an atlas (`atlas.ts`) whose padding texels, never written,
 *  hold zero — what a texel past the cache returns. An owned leaf's hit evaluates the lighting at
 *  its owner's transformed centroid: no stale coowner cell, no owner-sized radiance allocation. */
export const SURFACE_RAY_WGSL = `
${SURFACE_IRRADIANCE_WGSL}
fn rayRadiance(origin:vec3f,direction:vec3f,reach:f32)->vec4f{
 let hit=traceProxy(origin,direction,reach);
 if(!hit.found){return vec4f(0.0,0.0,0.0,reach);}
 // The face that counts is the one looking at the ray: the proxy is two-sided by construction.
 let geometric=proxyOwnerNormal(hit.triangle,hit.owner);
 let face=select(0u,1u,dot(geometric,direction)>0.0);
 if(hit.owner!=PROXY_POSED){
  let normal=select(geometric,-geometric,face==1u);
  let point=proxyOwnerCentre(hit.triangle,hit.owner);
  let lighting=directIrradiance(point,normal,reach)+sampleBounce(point,normal);
  return vec4f(proxyOwnerAlbedo(hit.owner)*lighting*INVERSE_PI,hit.distance);
 }
 let texel=hit.triangle*2u+face;
 let size=textureDimensions(surface);
 if(texel>=size.x*size.y){return vec4f(0.0,0.0,0.0,hit.distance);}
 return vec4f(textureLoad(surface,vec2u(texel%size.x,texel/size.x),0).rgb,hit.distance);
}`

/** The rough GGX prefilter convolves the existing radiance probe coefficients;
 * the mirror limit preserves the single original ray. The transition interpolates toward
 * the filtered lobe, never toward zero energy. With no probe yet, the environment answers.
 * `filteredReflectedRadiance` is the filtered lobe alone, never a proxy ray: what a rough
 * reflection sample's miss reads (#33, `reflections/sampleWgsl.ts`). */
export const bounceReflectionWgsl = (binding: number) => `
@group(0) @binding(${binding}) var surface:texture_2d<f32>;
${SURFACE_RAY_WGSL}
${mirrorWeightShader('wgsl')}
${PROBE_REFLECTION_FILTER_WGSL}
fn proxyReflectionRay(P:vec3f,N:vec3f,R:vec3f)->vec3f{
 let reach=bounce.reach.x;
 let hit=rayRadiance(P+N*proxy.offsetMetres+R*proxy.startMetres,R,reach);
 if(hit.w<reach){return hit.rgb;}
 return sampleBounce(P,R)*INVERSE_PI;
}
fn filteredReflectedRadiance(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec3f{
 if(bounce.counts.w==0u){return environmentReflection(R,rough);}
 return filteredProbeReflection(P,N,R,rough);
}
fn reflectedRadiance(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec3f{
 if(bounce.counts.w==0u){return environmentReflection(R,rough);}
 let weight=mirrorWeight(rough);
 if(weight==1.0){return proxyReflectionRay(P,N,R);}
 let filtered=filteredProbeReflection(P,N,R,rough);
 if(weight==0.0){return filtered;}
 return mix(filtered,proxyReflectionRay(P,N,R),weight);
}`

/**
 * The specular a smooth opaque surface returns from what it reflects (#31): the radiance along the
 * mirror direction, weighed by the GGX lobe's directional albedo the rectangular light already
 * reads (\`ltcLookup\`, texel 1: magnitude and Fresnel share) — the split-sum's second factor.
 *
 * The delta-direction contribution has full weight at the mirror limit and fades once over one
 * LTC roughness sample above it. Read at the floor so the shared water transition does not
 * also attenuate the proxy contribution inside this fade.
 * Beyond that interval the existing order-2 probe field is convolved with the rough lobe.
 * A diffuse or toon surface has no specular lobe and reflects nothing.
 */
export const MIRROR_LIGHTING_WGSL = mirrorLightingShader('wgsl')

/** The direct-only program's reflection: no proxy and no probe, the environment alone (#1341). */
export const DIRECT_REFLECTION_WGSL = `
${mirrorWeightShader('wgsl')}
${ENVIRONMENT_REFLECTION_WGSL}
fn filteredReflectedRadiance(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec3f{return environmentReflection(R,rough);}
fn reflectedRadiance(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec3f{return environmentReflection(R,rough);}
${MIRROR_LIGHTING_WGSL}`

/**
 * The deferred resolve's bounced diffuse light (\`bounceLighting\`), for a pixel whose mirror term
 * will read the probes' filtered lobe: a specular model, bounce on, and short of the mirror limit —
 * \`mirrorLighting\` and \`reflectedRadiance\` reading \`filteredProbeReflection\` past exactly these
 * tests. One walk of the probe corners gathers both (\`sampleProbeFields\`), and the lobe is held
 * for the mirror term, which reads it back for the same bits. Requires \`bounceReflectionWgsl\`.
 */
export const BOUNCE_SURFACE_FIELDS_WGSL = `${BOUNCE_FIELDS_WGSL}
fn bounceSurfaceLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32)->vec3f{
 if(surfaceModel==${MODEL_FLAG.diffuse}u||surfaceModel==${MODEL_FLAG.toon}u||bounce.counts.w==0u||mirrorWeight(rough)==1.0){
  return bounceLighting(rgb,metal,N,P,ao);
 }
 let R=reflect(-V,N);
 let fields=sampleProbeFields(P,N,R,reflectionProbeBands(rough));
 holdProbeSpecular(P,N,R,rough,fields.specular);
 return bounceDiffuse(rgb,metal,fields.diffuse,ao);
}`
