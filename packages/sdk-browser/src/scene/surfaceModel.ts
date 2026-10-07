/**
 * THE SURFACE MODELS BESIDE THE PHYSICAL ONE: HOW A NON-PBR MATERIAL READS IN THE ONE PIPELINE.
 *
 * The engine lights every surface with one model (`../lighting/standardLighting.ts`). A host material of
 * another family is mapped onto it, never given a pipeline of its own:
 * - `diffuse` (a Lambert material): the diffuse lobe of the same lights, and no specular one;
 * - `toon`: that diffuse lobe quantised into two bands at `N·L = 0.4`, the cel look;
 * - `normal`, `matcap`, `depth`: materials that show something other than light — the view-space
 *   normal as a colour, a matcap sampled by that normal, the depth — computed in the surface
 *   pass and drawn unlit.
 * A Phong material is the physical model itself, its shininess read as a roughness.
 *
 * The rank travels in three bits of the page row (`MODEL_SHIFT`); the surface pass writes the
 * lit ones as the surface flag (`MODEL_FLAG`) the resolve reads.
 */
import type { HostShadedMaterial } from '../host/shadedMaterial.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { lambertAlbedoMul } from '../../../math/src/wgsl/lighting.ts'
import { NORMAL_VIEW_COLOR } from './normalViewColor.ts'

export const SURFACE_MODEL = {
  standard: 0,
  diffuse: 1,
  toon: 2,
  normal: 3,
  matcap: 4,
  depth: 5,
} as const
/** Bits of the page row's flags word that carry the model; below them, the material flags. */
export const MODEL_SHIFT = 17
/** Surface-buffer flags of the lit models the resolve shades apart: 2 stays the physical one. */
export const MODEL_FLAG = { diffuse: 4, toon: 5 } as const
/** Surface-buffer flag of a debug view, a normal or depth surface: shown as-is, never fogged,
 *  and composed with neither exposure nor the display curve (`shownAsIs`). */
export const AS_IS_FLAG = 3
/** Low three G-buffer bits identify the surface model; higher bits are independent marks. */
export const SURFACE_MODEL_MASK = 7
/** The r8 surface target's high bit carries a material's fog opt-out. */
export const FOG_FREE_SURFACE_FLAG = 128
/** The surface target's mark of an emission-and-occlusion texel other than `(0, 0, 0, 1)`
 *  (`surfaceEmission.ts`); 32 is the thin subsurface's (`subsurface.ts`). */
export const EMISSIVE_AO_SURFACE_FLAG = 16
/** The forward item's model lane has one free bit after the three model bits. */
export const FOG_FREE_MODEL_BIT = 8

/** The one rule for debug views: a normal or depth surface is output untouched —
 *  no exposure, no tone mapping —: a debug view shows the raw value, never a tone-mapped one. */
export const shownAsIs = (model: number | undefined) =>
  model === SURFACE_MODEL.normal || model === SURFACE_MODEL.depth

/** The model a surface declares by its family; the physical model otherwise. */
export function hostSurfaceModel({ family }: HostShadedMaterial): number {
  if (family === 'lambert') return SURFACE_MODEL.diffuse
  if (family === 'toon') return SURFACE_MODEL.toon
  if (family === 'normal') return SURFACE_MODEL.normal
  if (family === 'matcap') return SURFACE_MODEL.matcap
  if (family === 'depth') return SURFACE_MODEL.depth
  return SURFACE_MODEL.standard
}

/** Whether a surface carries the metal-rough parameters: a standard or a physical one. */
export const metalRough = ({ family }: HostShadedMaterial) =>
  family === 'standard' || family === 'physical'

/** True when the surface's model is lit by the scene's lights: a Phong material is the standard
 *  model. */
export const litModel = (host: HostShadedMaterial) =>
  host.family === 'lambert' || host.family === 'toon' || metalRough(host) || host.family === 'phong'

/**
 * Why a surface declares a map that its model never reads, or `undefined`: a
 * toon's tone ramp, a matcap's colour map, the normal map of a surface drawn unlit. The one
 * refusal the page record holds (`../page/surface.ts`), so no surface drops one from the image.
 */
export function unreadMapRefusal(host: HostShadedMaterial) {
  const named = (map: string) =>
    `material ${host.family} declares a ${map} its surface model never reads`
  if (host.gradientMap) return named('gradientMap')
  if (host.family === 'matcap' && host.map) return named('map')
  if (host.normalMap && !litModel(host)) return named('normalMap')
}

/**
 * The roughness a Blinn–Phong exponent `n` reads as, `(2 / (n + 2))^¼`. The shaders square a
 * roughness into GGX's `α`, and `α² = 2 / (n + 2)` is the exponent the Blinn lobe gives that
 * `α` (`n = 2 / α² − 2`), the match of the two lobes' widths: a highlight 9.6° wide at
 * half its peak for `n = 30`, against 12.3° for the Phong lobe itself, where reading `α` as
 * `2 / (n + 2)` narrowed it to 2.3°.
 */
export const shininessRoughness = (shininess: number) =>
  Math.sqrt(Math.sqrt(2 / (Math.max(0, shininess) + 2)))

// The formulas of the models, written once: every pass shades a diffuse, toon or matcap surface
// from the same text, never a restated copy.
/** The diffuse lobe of a lamp's `energy`, occlusion `ao` included. */
const MODEL_DIFFUSE = `lambertAlbedoMul(rgb,metal)*energy*ao`
/** Toon's two bands of the cosine `nl`, 0.7 and 1. */
const TOON_BANDS = 'mix(0.7,1.0,smoothstep(0.69,0.71,nl*0.5+0.5))'
/** A diffuse surface's cosine. */
const DIFFUSE_COSINE = 'max(nl,0.0)'
/** The matcap coordinate of the view-space normal `n`. */
const MATCAP_UV = 'n.x*0.495+0.5,0.5-n.y*0.495'
export const NORMAL_VIEW_COLOR_WGSL = wgslBlock(
  'NORMAL_VIEW_COLOR_WGSL',
  [],
  `fn normalViewColor(N:vec3f)->vec3f{return ${NORMAL_VIEW_COLOR};}`,
)

/**
 * What a declared lamp gives a pixel of a diffuse or toon surface, read by `declaredLight` through
 * the private `surfaceModel` the resolve sets from the surface flag. Toon keeps the lamp's energy —
 * range, cone, shadow — and replaces the cosine by its two bands, 0.7 and 1.
 */
export const SURFACE_MODEL_LIGHT_WGSL = wgslBlock(
  'SURFACE_MODEL_LIGHT_WGSL',
  [lambertAlbedoMul],
  `
var<private> surfaceModel:u32;
fn modelLight(rgb:vec3f,metal:f32,N:vec3f,L:vec3f,energy:f32,ao:f32)->vec3f{
 let diffuse=${MODEL_DIFFUSE};
 let nl=dot(N,L);
 if(surfaceModel==${MODEL_FLAG.toon}u){return diffuse*${TOON_BANDS};}
 return diffuse*${DIFFUSE_COSINE};
}`,
)

/**
 * The unlit models in the surface pass: the view basis read off the view-projection (its first two
 * rows are the camera's right and up, up to the projection's scale), the view-space normal, then
 * the colour each shows. `depth` is the ramp of `writeDepthRamp` (`../camera/depthConvention.ts`):
 * white at the camera's near plane, black at its far one, linear in view distance.
 */
export const SURFACE_MODEL_SHADE_WGSL = wgslBlock(
  'SURFACE_MODEL_SHADE_WGSL',
  [],
  `
fn viewNormal(N:vec3f)->vec3f{
 let right=normalize(vec3f(uni.viewProj[0].x,uni.viewProj[1].x,uni.viewProj[2].x));
 let up=normalize(vec3f(uni.viewProj[0].y,uni.viewProj[1].y,uni.viewProj[2].y));
 return vec3f(dot(N,right),dot(N,up),dot(N,cross(right,up)));
}
fn matcapUv(N:vec3f)->vec2f{let n=viewNormal(N);return vec2f(${MATCAP_UV});}`,
)
