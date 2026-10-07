import { FULLSCREEN_XY_WGSL } from '../../gpu/shader/fullscreenTriangle.ts'
import { contractSurfaceBody, LIGHT_SURFACE_ENTRY, MIRROR_TERM_WGSL } from './surfaceWgsl.ts'
import { SUBSURFACE_TARGET } from '../../scene/subsurface.ts'
import { SURFACE_EMISSIVE_AO_WGSL } from '../../scene/surfaceEmission.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { directLightingWgsl } from '../direct/lightingWgsl.ts'
import type { ContractKey } from './contractCuts.ts'
import { BOUNCE_APPLY_WGSL } from '../../bounce/applyWgsl.ts'
import {
  BOUNCE_SURFACE_BINDING,
  BOUNCE_SURFACE_FIELDS_WGSL,
  DIRECT_REFLECTION_WGSL,
  bounceReflectionWgsl,
} from '../../bounce/reflectWgsl.ts'
import { MIRROR_LIGHTING_WGSL, PROBE_MIRROR_RADIANCE_WGSL } from '../../reflections/modelShader.ts'
import { TONE_MAPPING_WGSL } from '../toneMappingWgsl.ts'
import { AS_IS_FLAG } from '../../scene/surfaceModel.ts'
import { BLOOM_COMPOSE_WGSL } from '../../effects/bloomLevel.ts'
import { SRGB_ENCODE_WGSL } from '../../texture/srgbEncode.ts'
export const FULLSCREEN_VERTEX = `@vertex fn fullscreen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(${FULLSCREEN_XY_WGSL},0.0,1.0);}`
/** View uniform, shared by both programs and by the water composite: `viewport` carries the
 *  size, the raw-output flag of diagnostic views and the rank of a sampled image
 *  (`../direct/lightSamplingWgsl.ts`); `lightParams` the contract light count, tiles in X and Y, and
 *  exposure, applied before the display curve; `display.x` the rank of that curve
 *  (`../toneMappingWgsl.ts`), `display.yzw` the eye the fog is measured from; `jitter` the TAA's
 *  (`shadowJitterWords`, `jitterWords.ts`). The environment's irradiance and fog travel with the lights. */
export const VIEW_WGSL = `struct View{inverseViewProjection:mat4x4f,camera:vec4f,viewport:vec4f,background:vec4f,lightParams:vec4f,display:vec4f,jitter:vec4f,}`
/** World position of a pixel at a depth, reconstructed through that view: the one reading of
 *  the depth buffer every fullscreen pass shares. */
export const WORLD_AT_WGSL = `
fn worldAt(pixel:vec2f,z:f32)->vec3f{
 let ndc=vec4f(pixel.x/view.viewport.x*2.0-1.0,1.0-pixel.y/view.viewport.y*2.0,z,1.0);
 let world=view.inverseViewProjection*ndc;
 return world.xyz/world.w;
}`
/** The surfaces, their depth and the view: bindings 0 to 5 of every pass that lights a surface
 *  buffer — the deferred resolve, and the water composite, its word in the flags' place (`third`). */
export const surfaceBindingsWgsl = (third = 'flags:texture_2d<u32>') => `
@group(0) @binding(0) var baseMetal:texture_2d<f32>;
@group(0) @binding(1) var normalRough:texture_2d<f32>;
@group(0) @binding(2) var emissiveAo:texture_2d<f32>;
@group(0) @binding(3) var ${third};
@group(0) @binding(4) var depth:texture_depth_2d;
@group(0) @binding(5) var<uniform> view:View;`
/**
 * Unlit view: material albedo as-is, with no light and no ambient; what a surface emits is kept, as
 * in the lit image (#1362). This is not a light, it is a diagnostic view — the one geometry benches
 * that compare images pixel for pixel ask for, and the one the engine renders by default as long as
 * no light is declared, because a scene with no source has nothing to light.
 */
export const UNLIT_LIGHTING_SHADER = `
${VIEW_WGSL}
${surfaceBindingsWgsl()}
${SURFACE_EMISSIVE_AO_WGSL}
${FULLSCREEN_VERTEX}
${LIGHT_SURFACE_ENTRY}
 let coord=vec2i(pixel.xy);let flag=textureLoad(flags,coord,0).r;
 if(flag==0u){return vec4f(0.0);}
 return vec4f(textureLoad(baseMetal,coord,0).rgb+surfaceEmissiveAo(coord,flag).rgb,1.0);
}`
/** Contract bindings: declared lights and their per-tile lists. The virtual shadow maps' page
 *  table, projection data, uniforms and pool (8, 9, 10, 19) are declared with the shadow read
 *  (`directShadowWgsl`, `CONTRACT_VSM_BINDINGS`). */
export const CONTRACT_BINDINGS_WGSL = `
@group(0) @binding(6) var<storage,read> directLights:DirectLights;
@group(0) @binding(7) var<storage,read> tileLights:array<u32>;`
/** Shared body of the two contract programs: only the bounce lines separate them. */
const contractSurface = (bounce: string, diagnostic = '') =>
  `${FULLSCREEN_VERTEX}
${WORLD_AT_WGSL}
${contractSurfaceBody(bounce, diagnostic)}`
/** The bounce program's surface: bounced light, under the coat, and what a mirror reflects. */
const bounceSurfaceWgsl = () => `${BOUNCE_APPLY_WGSL}
${bounceReflectionWgsl(BOUNCE_SURFACE_BINDING)}
${BOUNCE_SURFACE_FIELDS_WGSL}
${MIRROR_LIGHTING_WGSL}
${PROBE_MIRROR_RADIANCE_WGSL}
fn thinBounce(N:vec3f,P:vec3f,ao:f32)->vec3f{
 if(!any(thinSubsurface>vec3f(0.0))){return vec3f(0.0);}
 return bounceLighting(thinSubsurface,0.0,-N,P,ao);
}
${contractSurface(
  `+bounceSurfaceLighting(base.rgb,base.a,normal.a,N,V,P,emissive.a)*lobeThrough()+thinBounce(N,P,emissive.a)${MIRROR_TERM_WGSL}`,
  'if(bounceOnly()){return vec4f(bounceIrradiance(N,P,view.lightParams.w),1.0);}',
)}`
/** The direct program's surface: what a specular lobe reflects of the environment (#1341). */
const directSurfaceWgsl = () => `${DIRECT_REFLECTION_WGSL}\n${contractSurface(MIRROR_TERM_WGSL)}`
/** Contract program: deferred resolve lit by the declared lights only, with their shadows, seen
 * through the scene's fog. No ambient term, no constant sky, no light written in the scene is
 * added. An unlit material shows its colour with no response to light, still seen through
 * the fog; a diagnostic, normal or depth surface comes out as-is. With `bounce`, bounced light:
 * probe irradiance multiplied by the pixel's diffuse albedo, and what a mirror reflects (#31),
 * added to the direct; without, a specular lobe reflects the environment alone (#1341). It is a
 * separate program, not a branch, so a session without bounce never pays for the probes — and so
 * is each program of a `key` (`contractCuts.ts`): `narrow` (#849), `unshadowed` (#1249),
 * `rectless` (#1369), without `lobeless` the lobes' (`../direct/lobesWgsl.ts`).
 */
export const contractLightingShader = (
  bounce: boolean,
  key: Partial<ContractKey> = { lobeless: true },
) => `
${VIEW_WGSL}
${surfaceBindingsWgsl()}
${SUBSURFACE_TARGET.wgsl}
${CONTRACT_BINDINGS_WGSL}
${STANDARD_LIGHTING_WGSL}
${directLightingWgsl(key)}
${bounce ? bounceSurfaceWgsl() : directSurfaceWgsl()}`
/**
 * How the composition reads a pixel's as-is share — 1 on a debug view (a normal or depth surface,
 * `AS_IS_FLAG`), 0 elsewhere —, binding 2, one read per pixel. A still image reads its surface
 * flag. An accumulated image reads the share the temporal pass resolved beside its colour, with the
 * same weights and history (`../../taa/shaderWgsl.ts`): the colour of an edge pixel is a history
 * blend, and its share follows it, so no pixel flips between the curve and none from one jitter to
 * the next.
 */
const AS_IS_READ = {
  still: {
    texture: 'texture_2d<u32>',
    share: `f32(textureLoad(asIs,coord,0).r==${AS_IS_FLAG}u)`,
  },
  accumulated: { texture: 'texture_2d<f32>', share: 'textureLoad(asIs,coord,0).r' },
} as const
/** The share read, or none in a frame with no as-is pixel (OMB-11): `asIsMix` at a share of 0. */
export type ComposeInput = keyof typeof AS_IS_READ | 'flagless'

/** The curved chain and the pixel as-is, weighed by its share: written out rather than `mix`, so a
 *  share of 1 yields the pixel as-is exactly, and selected, so a share of 0 yields the chain itself
 *  whatever the radiance holds. */
const asIsMix = (chain: string, share: string) =>
  `let share=${share};let curved=${chain};let untouched=value.rgb/max(value.a,1e-6);
 let color=linearToSrgb(select(curved,curved*(1.0-share)+untouched*share,share>0.0));`

/**
 * Composition, one source for two separate programs — never a branch in the shader.
 * `chain` is what linear radiance goes through before sRGB, and `curve` what must be
 * declared for that. Background, premultiplication and the raw output of diagnostic views are shared,
 * and so are debug views: a curved chain is weighed back to the pixel as-is by its share
 * (`AS_IS_READ`), since a normal or depth material is never exposed nor tone mapped. At a
 * share of 0 a lit pixel gets the chain before, bit for bit; the identity chain reads no share.
 * With `bloom`, `hdr` is the image the chain's last bloom read, blended here (`BLOOM_COMPOSE_WGSL`).
 */
const composeSource = (curve: string, chain: string, input: ComposeInput, bloom: boolean) => {
  const read = curve && input !== 'flagless' ? AS_IS_READ[input] : undefined
  return `
${VIEW_WGSL}
@group(0) @binding(0) var hdr:texture_2d<f32>;
@group(0) @binding(1) var<uniform> view:View;
${read ? `@group(0) @binding(2) var asIs:${read.texture};` : ''}
${bloom ? BLOOM_COMPOSE_WGSL : ''}
${FULLSCREEN_VERTEX}
${SRGB_ENCODE_WGSL}
${curve}
fn composeColor(pixel:vec4f)->vec4f{
 let coord=vec2i(pixel.xy);
 let value=${bloom ? 'bloomed(textureLoad(hdr,coord,0),pixel.xy)' : 'textureLoad(hdr,coord,0)'};
 if(value.a==0.0){return view.background;}
 if(view.viewport.z!=0.0){return vec4f(value.rgb,1.0);}
 ${read ? asIsMix(chain, read.share) : `let color=linearToSrgb(${chain});`}
 return vec4f(color*value.a+view.background.rgb*(1.0-value.a),1.0);
}
@fragment fn compose(@builtin(position) pixel:vec4f)->@location(0) vec4f{return composeColor(pixel);}
struct DisplayOutput{@location(0) capture:vec4f,@location(1) canvas:vec4f,}
@fragment fn composePresent(@builtin(position) pixel:vec4f)->DisplayOutput{
 let color=composeColor(pixel);
 return DisplayOutput(color,color);
}`
}
/** One composition per input: the still image's surface flags, the accumulated share, or none. */
const composeSources = (curve: string, chain: string, bloom = false) => ({
  still: composeSource(curve, chain, 'still', bloom),
  accumulated: composeSource(curve, chain, 'accumulated', bloom),
  flagless: composeSource(curve, chain, 'flagless', bloom),
})
/** A program's compositions: plain, and blending in the chain's last bloom (#963). */
const compositionsOf = (curve: string, chain: string) => ({
  plain: composeSources(curve, chain),
  bloom: composeSources(curve, chain, true),
})
/**
 * Contract composition: exposure multiplies linear radiance before the display curve the scene
 * chose — ACES unless it chose another —, last link of the chain. That is the one of
 * programs lit by declared lights.
 */
export const CONTRACT_COMPOSITIONS = compositionsOf(
  TONE_MAPPING_WGSL,
  'toneMap(value.rgb*view.lightParams.w/max(value.a,1e-6),u32(view.display.x))',
)
/**
 * Unlit-view composition: identity, from linear to sRGB and nothing else. With no declared
 * source there is no radiance to expose or bring into the display range — albedo is
 * read as-is, which is what benches that compare images pixel for pixel ask for.
 */
export const UNLIT_COMPOSITIONS = compositionsOf('', 'value.rgb/max(value.a,1e-6)')
