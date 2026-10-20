import { DEFERRED_BINDINGS } from './bindings.ts'
import { FULLSCREEN_XY } from '../../gpu/shader/fullscreenTriangle.ts'
import { contractSurfaceBody, LIGHT_SURFACE_ENTRY } from './surfaceWgsl.ts'
import { SUBSURFACE_TARGET } from '../../materials/surface/subsurface.ts'
import { SURFACE_EMISSIVE_AO_WGSL } from '../../materials/surface/surfaceEmission.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { directLightingWgsl } from '../direct/lightingWgsl.ts'
import { LOBELESS_KEY, type ContractKey, variantLabel } from './contractCuts.ts'
import { BOUNCE_APPLY_WGSL } from '../bounce/applyWgsl.ts'
import { DISPLAY_VALUE_WGSL } from '../toneMappingWgsl.ts'
import { TONE_MAPPING_RANK } from '../../../../sdk-core/src/scene/core/environment.ts'
import { AS_IS_FLAG } from '../../materials/surface/surfaceModel.ts'
import { BLOOM_COMPOSE_WGSL } from '../../post/effects/bloom/bloomLevel.ts'
import { linearToSrgb, luminance } from '../../../../math/src/wgsl/color.ts'
import { bilinear4, clampToExtent } from '../../../../math/src/wgsl/sampling.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { VIEW_WGSL, WORLD_AT_WGSL } from './worldAtWgsl.ts'
import { resolvedReflectionWgsl } from '../reflections/weight.ts'
/** The full-screen triangle's vertex stage (`FULLSCREEN_XY`), which every full-screen pass lists. */
export const FULLSCREEN_VERTEX = wgslBlock(
  'FULLSCREEN_VERTEX',
  [],
  `@vertex fn fullscreen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(${FULLSCREEN_XY},0.0,1.0);}`,
)
/** The surfaces, their depth and the view: bindings 0 to 5 of the deferred resolve. */
export const surfaceBindingsWgsl = () =>
  wgslBlock(
    'surfaceBindingsWgsl',
    [VIEW_WGSL],
    `@group(0) @binding(${DEFERRED_BINDINGS.baseMetal}) var baseMetal:texture_2d<f32>;
@group(0) @binding(${DEFERRED_BINDINGS.normalRough}) var normalRough:texture_2d<f32>;
@group(0) @binding(${DEFERRED_BINDINGS.emissiveAo}) var emissiveAo:texture_2d<f32>;
@group(0) @binding(${DEFERRED_BINDINGS.flags}) var flags:texture_2d<u32>;
@group(0) @binding(${DEFERRED_BINDINGS.depth}) var depth:texture_depth_2d;
@group(0) @binding(${DEFERRED_BINDINGS.view}) var<uniform> view:View;`,
  )
/**
 * Unlit view: material albedo as-is, with no light and no ambient; what a surface emits is kept, as
 * in the lit image (#1362). This is not a light, it is a diagnostic view — the one geometry benches
 * that compare images pixel for pixel ask for, and the one the engine renders by default as long as
 * no light is declared, because a scene with no source has nothing to light.
 */
export const UNLIT_LIGHTING_PROGRAM = wgslBlock(
  'UNLIT_LIGHTING_PROGRAM',
  [VIEW_WGSL, surfaceBindingsWgsl(), SURFACE_EMISSIVE_AO_WGSL, FULLSCREEN_VERTEX],
  `
${LIGHT_SURFACE_ENTRY}
 let coord=vec2i(pixel.xy);let flag=textureLoad(flags,coord,0).r;
 if(flag==0u){return vec4f(0.0);}
 return vec4f(textureLoad(baseMetal,coord,0).rgb+surfaceEmissiveAo(coord,flag).rgb,1.0);
}`,
)
/** Contract bindings: declared lights and their per-tile lists. The shadow mask, its transmission
 *  and tile words are declared with the shadow read (`directShadowWgsl`). */
export const CONTRACT_BINDINGS_WGSL = wgslBlock(
  'CONTRACT_BINDINGS_WGSL',
  [],
  `@group(0) @binding(${DEFERRED_BINDINGS.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${DEFERRED_BINDINGS.tiles}) var<storage,read> tileLights:array<u32>;`,
)
/** Shared body of the two contract programs, what its surface lists: only the bounce lines
 *  separate them. Each program lists the full-screen vertex (`FULLSCREEN_VERTEX`). */
const contractSurface = (bounce: boolean) => [WORLD_AT_WGSL, contractSurfaceBody(bounce)]
/** The bounce program's surface: bounced light, under the coat. */
const BOUNCE_SURFACE_WGSL = wgslBlock(
  'BOUNCE_SURFACE_WGSL',
  [BOUNCE_APPLY_WGSL, FULLSCREEN_VERTEX, ...contractSurface(true)],
  '',
)
/** No bounced light: what a program without the probes answers where the lighting samples it — a
 *  thin surface's back (\`thinBack\`) — zero. */
const NO_BOUNCE_WGSL = wgslBlock(
  'NO_BOUNCE_WGSL',
  [],
  'fn sampleBounce(P:vec3f,N:vec3f)->vec3f{return vec3f(0.0);}',
)
/** The direct program's surface: no bounce (\`NO_BOUNCE_WGSL\`). */
const DIRECT_SURFACE_WGSL = wgslBlock(
  'DIRECT_SURFACE_WGSL',
  [NO_BOUNCE_WGSL, FULLSCREEN_VERTEX, ...contractSurface(false)],
  '',
)
/** Contract program: deferred resolve lit by the declared lights only, with their shadows, seen
 * through the scene's fog. No ambient term, no constant sky, no light written in the scene is
 * added. An unlit material shows its colour with no response to light, still seen through
 * the fog; a diagnostic, normal or depth surface comes out as-is. What a lit surface reflects is
 * the radiance the reflection trace wrote for its pixel (`resolvedReflection`,
 * `../reflections/weight.ts`). With `bounce`, bounced light:
 * probe irradiance multiplied by the pixel's diffuse albedo, added to the direct. It is a
 * separate program, not a branch, so a session without bounce never pays for the probes — and so
 * is each program of a `key` (`contractCuts.ts`): `narrow` (#849), `unshadowed` (#1249),
 * `rectless` (#1369), without `lobeless` the lobes' (`../direct/lobesWgsl.ts`). Its name carries
 * the program's key, so no two variants collide.
 */
export const contractLightingProgram = (
  bounce: boolean,
  key: Partial<ContractKey> = LOBELESS_KEY,
) =>
  wgslBlock(
    `contractLightingProgram(${bounce ? 'BOUNCE' : 'DIRECT'}${variantLabel(key)})`,
    [
      STANDARD_LIGHTING_WGSL,
      directLightingWgsl(key),
      bounce ? BOUNCE_SURFACE_WGSL : DIRECT_SURFACE_WGSL,
      resolvedReflectionWgsl,
      VIEW_WGSL,
      surfaceBindingsWgsl(),
      CONTRACT_BINDINGS_WGSL,
    ],
    SUBSURFACE_TARGET.wgsl,
  )

/**
 * How the composition reads a pixel's as-is share — 1 on a debug view (a normal or depth surface,
 * `AS_IS_FLAG`), 0 elsewhere —, binding 2, one read per pixel. A still image reads its surface
 * flag. An accumulated image reads the share the temporal pass resolved beside its colour, with the
 * same weights and history (`../../post/taa/shaderWgsl.ts`): the colour of an edge pixel is a history
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
const asIsMix = (curved: string, share: string) =>
  `let share=${share};let curved=${curved};let untouched=value.rgb/max(value.a,1e-6);
 let color=linearToSrgb(select(curved,curved*(1.0-share)+untouched*share,share>0.0));`

/** What linear radiance goes through before `displayValue`: `exposed`, the radiance with its
 *  exposure applied, the expression of the curve's rank, and `lit`, the chain of programs lit by
 *  declared lights: the pixel's as-is share (`AS_IS_READ`) weighs it and the source is sharpened before
 *  the curve (`SHARPEN_WGSL`). */
type Chain = { exposed: string; curve: string; lit: boolean }

/**
 * The sharpen, in the composition itself, never a pass or a target of its own: the source pixel and
 * its cross, one source pixel away, read once each (`sourceValue`), before the bloom and the curve;
 * the pixel pulled away from its cross's sum by the strength over six (`strength / 6`, so a strength
 * of 1 is a unit-gain Laplacian), the view's sharpness (`view.viewport.w`), masked off where the
 * exposed luminance steps by one or more against a neighbour (`edge`), so a very bright edge is
 * never sharpened into a ring. A neighbour past the last column or row reads the last one. At a
 * strength of 0 — a uniform branch — and in a diagnostic view's raw output the pixel is composed as
 * it is, bit for bit.
 */
const SHARPEN_WGSL = `
fn sourceNear(at:vec2f,step:vec2f)->vec3f{
 return sourceValue(clamp(at+step,vec2f(0.0),view.source.zw+0.999)).rgb;
}
fn composeColor(pixel:vec4f)->vec4f{
 let at=pixel.xy*view.source.xy;
 let value=sourceValue(at);
 let strength=view.viewport.w;
 if(strength==0.0||view.viewport.z!=0.0){return composeAt(at,value);}
 let c1=sourceNear(at,vec2f(-1.0,0.0));let c2=sourceNear(at,vec2f(1.0,0.0));
 let c3=sourceNear(at,vec2f(0.0,-1.0));let c4=sourceNear(at,vec2f(0.0,1.0));
 let a0=luminance(value.rgb);
 let steps=abs(vec4f(a0)-vec4f(luminance(c1),luminance(c2),luminance(c3),luminance(c4)));
 let edge=saturate(1.0-view.lightParams.w*max(max(steps.x,steps.y),max(steps.z,steps.w)));
 let delta=(c1+c2+c3+c4)-value.rgb*4.0;
 return composeAt(at,vec4f(value.rgb+delta*(-edge*strength/6.0),value.a));
}`
/** The composition with no sharpening: the display pixel composed once. */
const UNSHARPENED_WGSL = `
fn composeColor(pixel:vec4f)->vec4f{
 let at=pixel.xy*view.source.xy;
 return composeAt(at,sourceValue(at));
}`
/**
 * Composition, one source for two separate programs — never a branch in the shader.
 * `chain` is what linear radiance goes through before sRGB, always `displayValue`. Background, premultiplication and the raw output of diagnostic views are shared,
 * and so are debug views: a curved chain is weighed back to the pixel as-is by its share
 * (`AS_IS_READ`), since a normal or depth material is never exposed nor tone mapped. At a
 * share of 0 a lit pixel gets the chain before, bit for bit; the identity chain (curve none) reads no share.
 * With `bloom`, `hdr` is the image the chain's last bloom read, blended here (`BLOOM_COMPOSE_WGSL`).
 * The source is read where the display pixel falls in it (`view.source`): at its size, its pixel
 * as it is; drawn below it with no temporal resolve to rebuild it (`../../webgpu/pages/state/
 * renderScale.ts`), its four nearest pixels blended — the one upscale of such an image —, the as-is
 * share and the bloom read at the same place.
 */
const composeSource = (chain: Chain, input: ComposeInput, bloom: boolean) => {
  const read = chain.lit && input !== 'flagless' ? AS_IS_READ[input] : undefined
  return wgslProgram(
    `
@group(0) @binding(0) var hdr:texture_2d<f32>;
@group(0) @binding(1) var<uniform> view:View;
${read ? `@group(0) @binding(2) var asIs:${read.texture};` : ''}
fn sourceValue(at:vec2f)->vec4f{
 if(all(view.source.xy==vec2f(1.0))){return textureLoad(hdr,vec2i(at),0);}
 let t=at-0.5;let i=vec2i(floor(t));let f=t-floor(t);let size=vec2i(view.source.zw)+1;
 let a=clampToExtent(i,size);let b=clampToExtent(i+1,size);
 return bilinear4(textureLoad(hdr,a,0),textureLoad(hdr,vec2i(b.x,a.y),0),textureLoad(hdr,vec2i(a.x,b.y),0),textureLoad(hdr,b,0),f);
}
fn composeAt(at:vec2f,source:vec4f)->vec4f{
 let coord=vec2i(at);
 let value=${bloom ? 'bloomed(source,at)' : 'source'};
 if(value.a==0.0){return view.background;}
 if(view.viewport.z!=0.0){return vec4f(value.rgb,1.0);}
 ${read ? asIsMix(`toneMap(${chain.exposed},${chain.curve})`, read.share) : `let color=displayValue(${chain.exposed},${chain.curve});`}
 return vec4f(color*value.a+view.background.rgb*(1.0-value.a),1.0);
}
${chain.lit ? SHARPEN_WGSL : UNSHARPENED_WGSL}
@fragment fn compose(@builtin(position) pixel:vec4f)->@location(0) vec4f{return composeColor(pixel);}
struct DisplayOutput{@location(0) capture:vec4f,@location(1) canvas:vec4f,}
@fragment fn composePresent(@builtin(position) pixel:vec4f)->DisplayOutput{
 let color=composeColor(pixel);
 return DisplayOutput(color,color);
}`,
    [
      VIEW_WGSL,
      ...(bloom ? [BLOOM_COMPOSE_WGSL] : []),
      FULLSCREEN_VERTEX,
      linearToSrgb,
      DISPLAY_VALUE_WGSL,
      bilinear4,
      clampToExtent,
      ...(chain.lit ? [luminance] : []),
    ],
  )
}
/** One composition per input: the still image's surface flags, the accumulated share, or none. */
const composeSources = (chain: Chain, bloom = false) => ({
  still: composeSource(chain, 'still', bloom),
  accumulated: composeSource(chain, 'accumulated', bloom),
  flagless: composeSource(chain, 'flagless', bloom),
})
/** A program's compositions: plain, and blending in the chain's last bloom (#963). */
const compositionsOf = (chain: Chain) => ({
  plain: composeSources(chain),
  bloom: composeSources(chain, true),
})
/**
 * Contract composition: exposure multiplies linear radiance before the display curve the scene
 * chose — ACES unless it chose another —, last link of the chain. That is the one of
 * programs lit by declared lights.
 */
export const CONTRACT_COMPOSITIONS = compositionsOf({
  exposed: 'value.rgb*view.lightParams.w/max(value.a,1e-6)',
  curve: 'u32(view.display.x)',
  lit: true,
})
/**
 * Unlit-view composition: identity, from linear to sRGB and nothing else. With no declared
 * source there is no radiance to expose or bring into the display range — albedo is
 * read as-is, which is what benches that compare images pixel for pixel ask for.
 */
export const UNLIT_COMPOSITIONS = compositionsOf({
  exposed: 'value.rgb/max(value.a,1e-6)',
  curve: `${TONE_MAPPING_RANK.none}u`,
  lit: false,
})
