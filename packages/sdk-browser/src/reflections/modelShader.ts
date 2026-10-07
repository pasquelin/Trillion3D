import { ROUGHNESS_FLOOR, shaderFloat } from '../lighting/shaderConstants.ts'
import { LTC_SIZE } from '../../../sdk-core/src/lighting/ltcTable.ts'
import { MODEL_FLAG } from '../scene/surfaceModel.ts'

/** One roughness sample of the lobe table: transition resolution, not a rough-lobe filter. */
export const MIRROR_TRANSITION_END = shaderFloat(Number(ROUGHNESS_FLOOR) + 1 / (LTC_SIZE - 1))
/** The roughness above which a lobe is never screen-traced and takes the environment/probe
 *  reflection alone (#1341). */
export const SCREEN_REFLECTION_CUTOFF = 0.6
export const SCREEN_REFLECTION_MAX_ROUGHNESS = shaderFloat(SCREEN_REFLECTION_CUTOFF)
/** A blended surface's: screen reflection fades linearly by
 *  `saturate(2 - 6.6·roughness)`, whole to 1/6.6 and none from 2/6.6. */
export const TRANSLUCENT_SCREEN_REFLECTION_MAX_ROUGHNESS = shaderFloat(2 / 6.6)
export const MIRROR_WEIGHT_WGSL = `
fn mirrorWeight(rough:f32)->f32{
 return 1.0-smoothstep(${ROUGHNESS_FLOOR},${MIRROR_TRANSITION_END},rough);
}`

/**
 * The specular a smooth opaque surface returns from what it reflects (#31), one split-sum model for
 * the deferred and forward programs: the radiance along the mirror direction, weighed by the GGX
 * lobe's directional albedo the rectangular light already reads (`ltcLookup`, texel 1: magnitude
 * and Fresnel share) — the split-sum's second factor.
 *
 * The delta-direction contribution has full weight at the mirror limit and fades once over one
 * LTC roughness sample above it. Read at the floor so the shared water transition does not
 * also attenuate the proxy contribution inside this fade.
 * Beyond that interval the existing order-2 probe field is convolved with the rough lobe.
 * A diffuse or toon surface has no specular lobe and reflects nothing.
 *
 * `surfaceMirrorLighting` is the surface's term, of reflectance `DIELECTRIC_F0` to the albedo by
 * metalness, as the lights' (`../lighting/standardLighting.ts`); `mirrorLighting` puts it under a
 * clear coat with the coat's own (`lobeMirror`, `../lighting/direct/lobesWgsl.ts`). The radiance
 * along the mirror direction is the program's `mirrorRadiance`: the probes' or the environment's
 * (`PROBE_MIRROR_RADIANCE_WGSL`), or the screen's resolved over them (`SCREEN_MIRROR_RADIANCE_WGSL`).
 */
export const MIRROR_LIGHTING_WGSL = `
fn surfaceMirrorLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f)->vec3f{
 if(surfaceModel==${MODEL_FLAG.diffuse}u||surfaceModel==${MODEL_FLAG.toon}u){return vec3f(0.0);}
 let t=ltcLookup(rough,clamp(dot(N,V),1e-4,1.0),1u);
 let f0=mix(DIELECTRIC_F0,rgb,metal);
 return (f0*t.x+(vec3f(1.0)-f0)*t.y)*mirrorRadiance(P,N,reflect(-V,N),rough);
}
fn mirrorLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f)->vec3f{
 return lobeMirror(surfaceMirrorLighting(rgb,metal,rough,N,V,P),V,P);
}`

/** A program's mirror radiance without screen reflections: its own reflection model. */
export const PROBE_MIRROR_RADIANCE_WGSL = `
fn mirrorRadiance(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec3f{return reflectedRadiance(P,N,R,rough);}`

/** A program's mirror radiance with screen reflections: the screen's hits, resolved over its own
 *  model where none answers (`resolvedRadiance`, `screenWgsl.ts`). */
export const SCREEN_MIRROR_RADIANCE_WGSL = `
fn mirrorRadiance(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec3f{return resolvedRadiance(P,N,R,rough);}`

/** The mirror term of a forward pass: the model's (`MIRROR_LIGHTING_WGSL`) on the radiance the pass
 *  resolves itself (`SCREEN_MIRROR_RADIANCE_WGSL`) — the blends', and the water's coat
 *  (`../webgpu/water/waterLobesWgsl.ts`). */
export const FORWARD_MIRROR_WGSL = `${MIRROR_LIGHTING_WGSL}${SCREEN_MIRROR_RADIANCE_WGSL}`
