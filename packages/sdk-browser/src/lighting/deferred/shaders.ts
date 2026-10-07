import { FULLSCREEN_XY } from '../../gpu/shader/fullscreenTriangle.ts'
import { contractSurfaceBody, LIGHT_SURFACE_ENTRY } from './surfaceWgsl.ts'
import { SUBSURFACE_TARGET } from '../../scene/subsurface.ts'
import { SURFACE_EMISSIVE_AO_WGSL } from '../../scene/surfaceEmission.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { directLightingWgsl } from '../direct/lightingWgsl.ts'
import { type ContractKey, variantLabel } from './contractCuts.ts'
import { BOUNCE_APPLY_WGSL } from '../../bounce/applyWgsl.ts'
import {
  BOUNCE_SURFACE_BINDING,
  BOUNCE_SURFACE_FIELDS_WGSL,
  DIRECT_REFLECTION_WGSL,
  bounceReflectionWgsl,
} from '../../bounce/reflectWgsl.ts'
import { mirrorLightingWgsl, PROBE_MIRROR_RADIANCE } from '../../reflections/modelShader.ts'
import { TONE_MAPPING_WGSL } from '../toneMappingWgsl.ts'
import { AS_IS_FLAG } from '../../scene/surfaceModel.ts'
import { BLOOM_COMPOSE_WGSL } from '../../effects/bloomLevel.ts'
import { linearToSrgb } from '../../../../math/src/wgsl/color.ts'
import { type WgslDecl, wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { VIEW_WGSL, WORLD_AT_WGSL } from './worldAtWgsl.ts'
/** The full-screen triangle's vertex stage (`FULLSCREEN_XY`), which every full-screen pass lists. */
export const FULLSCREEN_VERTEX = wgslBlock(
  'FULLSCREEN_VERTEX',
  [],
  `@vertex fn fullscreen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(${FULLSCREEN_XY},0.0,1.0);}`,
)
/** The surfaces, their depth and the view: bindings 0 to 5 of every pass that lights a surface
 *  buffer — the deferred resolve, and the water composite, its word in the flags' place (`third`). */
export const surfaceBindingsWgsl = (third = 'flags:texture_2d<u32>') =>
  wgslBlock(
    `surfaceBindingsWgsl(${third})`,
    [VIEW_WGSL],
    `@group(0) @binding(0) var baseMetal:texture_2d<f32>;
@group(0) @binding(1) var normalRough:texture_2d<f32>;
@group(0) @binding(2) var emissiveAo:texture_2d<f32>;
@group(0) @binding(3) var ${third};
@group(0) @binding(4) var depth:texture_depth_2d;
@group(0) @binding(5) var<uniform> view:View;`,
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
/** Contract bindings: declared lights and their per-tile lists. The virtual shadow maps' page
 *  table, projection data, uniforms and pool (8, 9, 10, 19) are declared with the shadow read
 *  (`directShadowWgsl`, `CONTRACT_VSM_BINDINGS`). */
export const CONTRACT_BINDINGS_WGSL = wgslBlock(
  'CONTRACT_BINDINGS_WGSL',
  [],
  `@group(0) @binding(6) var<storage,read> directLights:DirectLights;
@group(0) @binding(7) var<storage,read> tileLights:array<u32>;`,
)
/** Shared body of the two contract programs, what its surface lists: only the bounce lines
 *  separate them. Each program lists the full-screen vertex (`FULLSCREEN_VERTEX`). */
const contractSurface = (bounce: boolean) => [WORLD_AT_WGSL, contractSurfaceBody(bounce)]
/** The bounce program's surface: bounced light, under the coat, and what a mirror reflects
 *  (`mirrorLightingWgsl`, on the radiance `mirror` its pass chooses). */
const bounceSurfaceWgsl = (mirror: WgslDecl) =>
  wgslBlock(
    'bounceSurfaceWgsl',
    [
      BOUNCE_APPLY_WGSL,
      bounceReflectionWgsl(BOUNCE_SURFACE_BINDING),
      mirrorLightingWgsl(mirror),
      BOUNCE_SURFACE_FIELDS_WGSL,
      FULLSCREEN_VERTEX,
      ...contractSurface(true),
    ],
    `fn thinBounce(N:vec3f,P:vec3f,ao:f32)->vec3f{
 if(!any(thinSubsurface>vec3f(0.0))){return vec3f(0.0);}
 return bounceLighting(thinSubsurface,0.0,-N,P,ao);
}`,
  )
/** The direct program's surface: what a specular lobe reflects of the environment (#1341), on
 *  the radiance `mirror` its pass chooses. */
const directSurfaceWgsl = (mirror: WgslDecl) =>
  wgslBlock(
    'directSurfaceWgsl',
    [
      DIRECT_REFLECTION_WGSL,
      mirrorLightingWgsl(mirror),
      FULLSCREEN_VERTEX,
      ...contractSurface(false),
    ],
    '',
  )
/** Contract program: deferred resolve lit by the declared lights only, with their shadows, seen
 * through the scene's fog. No ambient term, no constant sky, no light written in the scene is
 * added. An unlit material shows its colour with no response to light, still seen through
 * the fog; a diagnostic, normal or depth surface comes out as-is. With `bounce`, bounced light:
 * probe irradiance multiplied by the pixel's diffuse albedo, and what a mirror reflects (#31),
 * added to the direct; without, a specular lobe reflects the environment alone (#1341). It is a
 * separate program, not a branch, so a session without bounce never pays for the probes — and so
 * is each program of a `key` (`contractCuts.ts`): `narrow` (#849), `unshadowed` (#1249),
 * `rectless` (#1369), without `lobeless` the lobes' (`../direct/lobesWgsl.ts`).
 *
 * It is a `LitProgram`: the pass that compiles it chooses its mirror radiance — the probes' or the
 * environment's (`PROBE_MIRROR_RADIANCE`, the default), or the screen's resolved over them
 * (`withScreenReflections`) —, a declaration its mirror term lists, so the text is assembled once
 * with the one it names. Its name carries the program's key, so no two variants collide.
 */
export const contractLightingProgram =
  (bounce: boolean, key: Partial<ContractKey> = { lobeless: true }): LitProgram =>
  (mirror = PROBE_MIRROR_RADIANCE) =>
    wgslBlock(
      `contractLightingProgram(${bounce ? 'BOUNCE' : 'DIRECT'}${variantLabel(key)})`,
      [
        STANDARD_LIGHTING_WGSL,
        directLightingWgsl(key),
        bounce ? bounceSurfaceWgsl(mirror) : directSurfaceWgsl(mirror),
        VIEW_WGSL,
        surfaceBindingsWgsl(),
        CONTRACT_BINDINGS_WGSL,
      ],
      SUBSURFACE_TARGET.wgsl,
    )

/** A lit program at the mirror radiance its pass chooses (`contractLightingProgram`): the plain
 *  resolve's default, the screen reflections' passes theirs. */
export type LitProgram = (mirror?: WgslDecl) => WgslDecl
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
 * `chain` is what linear radiance goes through before sRGB, and `curve` the declarations it
 * calls, none for the identity. Background, premultiplication and the raw output of diagnostic views are shared,
 * and so are debug views: a curved chain is weighed back to the pixel as-is by its share
 * (`AS_IS_READ`), since a normal or depth material is never exposed nor tone mapped. At a
 * share of 0 a lit pixel gets the chain before, bit for bit; the identity chain reads no share.
 * With `bloom`, `hdr` is the image the chain's last bloom read, blended here (`BLOOM_COMPOSE_WGSL`).
 */
const composeSource = (
  curve: WgslDecl | null,
  chain: string,
  input: ComposeInput,
  bloom: boolean,
) => {
  const read = curve && input !== 'flagless' ? AS_IS_READ[input] : undefined
  return wgslProgram(
    `
@group(0) @binding(0) var hdr:texture_2d<f32>;
@group(0) @binding(1) var<uniform> view:View;
${read ? `@group(0) @binding(2) var asIs:${read.texture};` : ''}
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
}`,
    [
      VIEW_WGSL,
      ...(bloom ? [BLOOM_COMPOSE_WGSL] : []),
      FULLSCREEN_VERTEX,
      linearToSrgb,
      ...(curve ? [curve] : []),
    ],
  )
}
/** One composition per input: the still image's surface flags, the accumulated share, or none. */
const composeSources = (curve: WgslDecl | null, chain: string, bloom = false) => ({
  still: composeSource(curve, chain, 'still', bloom),
  accumulated: composeSource(curve, chain, 'accumulated', bloom),
  flagless: composeSource(curve, chain, 'flagless', bloom),
})
/** A program's compositions: plain, and blending in the chain's last bloom (#963). */
const compositionsOf = (curve: WgslDecl | null, chain: string) => ({
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
export const UNLIT_COMPOSITIONS = compositionsOf(null, 'value.rgb/max(value.a,1e-6)')
