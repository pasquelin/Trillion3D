/**
 * THE SURFACE MODELS BESIDE THE PHYSICAL ONE: HOW A NON-PBR MATERIAL READS IN THE ONE PIPELINE.
 *
 * The engine lights every surface with one model (`../../lighting/standardLighting.ts`). A surface of
 * another family is mapped onto it, never given a pipeline of its own:
 * - `diffuse` (a Lambert material): the diffuse lobe of the same lights, and no specular one;
 * - `toon`: that diffuse lobe quantised into two bands at `N·L = 0.4`, the cel look;
 * - `normal`, `matcap`, `depth`: materials that show something other than light — the view-space
 *   normal as a colour, a matcap sampled by that normal, the depth — computed in the surface
 *   pass and drawn unlit;
 * - `shadow`, the shadow catcher: always blended, its colour at its opacity times the share of its
 *   shadowed lights' light the shadows take away (`catcherAlpha`), so it is seen only where a
 *   shadow falls.
 * A Phong material is the physical model itself, its shininess read as a roughness.
 *
 * The rank travels in three bits of the page row (`MODEL_SHIFT`); the surface pass writes the
 * lit ones as the surface flag (`MODEL_FLAG`) the resolve reads.
 */
import type { SurfaceFamily } from '../../geometry/pages/surface.ts'
import type { SurfaceDeclaration } from '../../geometry/pages/surfaceDeclaration.ts'
import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { lambertAlbedoMul } from '../../../../math/src/wgsl/lighting.ts'
import { signedToUnit3 } from '../../../../math/src/wgsl/reals.ts'
import { PIXEL_MODEL, pixelModelOf } from './pixelModel.ts'
import { MODEL_FLAG, SURFACE_MODEL, SURFACE_MODEL_MASK } from './surfaceModelWord.ts'

/**
 * A shadow catcher's alpha (three.js's `ShadowMaterial`): its `opacity` times the share of its
 * shadowed lights' light the shadows take away at the point — `lights`, the catcher's sum of the
 * light loop, holds what reaches it in `x` and what would reach it unshadowed in `y`
 * (`declaredLight`). Zero where no shadowed light reaches it: the catcher is unseen.
 */
export const catcherAlpha = wgslFn(
  'catcherAlpha',
  [],
  `fn catcherAlpha(opacity:f32,lights:vec3f)->f32{return select(0.0,opacity*saturate(1.0-lights.x/lights.y),lights.y>0.0);}`,
)
/** Whether a surface of surface-buffer flags `flags` reflects: the physical model alone has a
 *  specular lobe — a hair has none, whatever model bits it carries (`pixelModelOf`) —, the one rule of
 *  the opaque trace (the flags it reads) and the forward programs (their `surfaceModel`, the flag itself). */
export const surfaceReflects = wgslFn(
  'surfaceReflects',
  [pixelModelOf],
  `fn surfaceReflects(flags:u32)->bool{return (flags&${SURFACE_MODEL_MASK}u)==${MODEL_FLAG.physical}u&&pixelModelOf(flags)!=${PIXEL_MODEL.hair}u;}`,
)
/** The surface flags' eighth bit carries a material's fog opt-out. */
export const FOG_FREE_SURFACE_FLAG = 128
/** The surface target's mark of an emission-and-occlusion texel other than `(0, 0, 0, 1)`
 *  (`surfaceEmission.ts`); 32 is the thin subsurface's (`subsurface.ts`). */
export const EMISSIVE_AO_SURFACE_FLAG = 16
/** The surface flags' twenty-fifth bit marks a first-person primitive: the pixels of an object the camera's
 *  owner holds (`PLACEMENT_FIRST_PERSON`, `PageInfo.marks`), which the lighting treats apart — the
 *  shadows read it. Written by the opaque resolve beside the model, read through `isFirstPerson`. */
export const FIRST_PERSON_SURFACE_FLAG = 1 << 24
/** The surface flags' seventeenth bit: the pixel's object lets the contact shadow rays through (`Object3D.castContactShadow`
 *  false). Set by the resolve (`withPageMarks`), above the specular's byte; a flags word no pass wrote it in casts. */
export const NO_CONTACT_SHADOW_SURFACE_FLAG = 1 << 16
/** Whether a surface of flags `flags` lets the contact shadow rays through (`NO_CONTACT_SHADOW_SURFACE_FLAG`). */
export const noContactShadow = wgslFn(
  'noContactShadow',
  [],
  `fn noContactShadow(flags:u32)->bool{return (flags&${NO_CONTACT_SHADOW_SURFACE_FLAG}u)!=0u;}`,
)
/** The surface flags' twenty-first bit marks a pixel of an object that casts an indirect capsule shadow (`Object3D.castCapsuleIndirectShadow`): its own surface keeps
 *  less of that shadow (`capsuleIndirectSelfShadowingIntensity`). Written by the opaque resolve beside the other marks, read by the capsule shadows
 *  (`capsuleCastsIndirect`); above the lighting channels' three bits. */
export const CAPSULE_CASTER_SURFACE_FLAG = 1 << 20
/** The surface flags' thirtieth bit marks a pixel of a held-out primitive (`PLACEMENT_HOLDOUT`,
 *  `FLAG_HOLDOUT`) the resolve drew black, lit by nothing, where the alpha holdout is in effect: the colour pass gives
 *  it an alpha of 1, a hole in the image's. Beside the unlit model, above the pixel model's four bits. */
export const HOLDOUT_SURFACE_FLAG = 1 << 29
/** Whether a surface of surface-buffer flags `flags` is a first-person primitive's. */
export const isFirstPerson = wgslFn(
  'isFirstPerson',
  [],
  `fn isFirstPerson(flags:u32)->bool{return (flags&${FIRST_PERSON_SURFACE_FLAG}u)!=0u;}`,
)
/** The one rule for debug views: a normal or depth surface is output untouched —
 *  no exposure, no tone mapping —: a debug view shows the raw value, never a tone-mapped one. */
export const shownAsIs = (model: number | undefined) =>
  model === SURFACE_MODEL.normal || model === SURFACE_MODEL.depth

/** The model a surface of `family` reads in; the physical model otherwise. */
export function familyModel(family: SurfaceFamily): number {
  if (family === 'lambert') return SURFACE_MODEL.diffuse
  if (family === 'toon') return SURFACE_MODEL.toon
  if (family === 'normal') return SURFACE_MODEL.normal
  if (family === 'matcap') return SURFACE_MODEL.matcap
  if (family === 'depth') return SURFACE_MODEL.depth
  if (family === 'shadow') return SURFACE_MODEL.shadow
  return SURFACE_MODEL.standard
}

/** Whether a family carries the metal-rough parameters: a standard or a physical one. */
export const metalRoughFamily = (family: SurfaceFamily) =>
  family === 'standard' || family === 'physical'

/** True when the family's model is lit by the scene's lights: a Phong surface is the standard
 *  model; a shadow catcher reads their shadows. */
export const litFamily = (family: SurfaceFamily) =>
  family === 'lambert' ||
  family === 'toon' ||
  metalRoughFamily(family) ||
  family === 'phong' ||
  family === 'shadow'

/**
 * Why a declaration names a map that its model never reads, or `undefined`: a tone ramp, which no
 * model reads, a matcap's colour map, the normal map of a surface drawn unlit (`litFamily`). The one refusal the surface
 * record holds (`../../geometry/pages/surfaceRecord.ts`), so no surface drops one from the image.
 */
export function unreadMapRefusal(declared: SurfaceDeclaration) {
  const { family } = declared
  const named = (map: string) =>
    `material ${family} declares a ${map} its surface model never reads`
  if (declared.gradientMap) return named('gradientMap')
  if (family === 'matcap' && declared.map) return named('map')
  if (declared.normalMap && !litFamily(family)) return named('normalMap')
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
/** The diffuse lobe of a lamp's `energy`, its surface shadow's: the occlusion is not a second factor. */
const MODEL_DIFFUSE = `lambertAlbedoMul(rgb,metal)*energy`
/** Toon's two bands of the cosine `nl`, 0.7 and 1. */
const TOON_BANDS = 'mix(0.7,1.0,smoothstep(0.69,0.71,nl*0.5+0.5))'
/** A diffuse surface's cosine. */
const DIFFUSE_COSINE = 'max(nl,0.0)'
/** The matcap coordinate of the view-space normal `n`. */
const MATCAP_UV = 'n.x*0.495+0.5,0.5-n.y*0.495'
/** A view-space unit normal as the debug colour of the normals view. */
export const NORMAL_VIEW_COLOR_WGSL = wgslBlock(
  'NORMAL_VIEW_COLOR_WGSL',
  [signedToUnit3],
  'fn normalViewColor(N:vec3f)->vec3f{return signedToUnit3(N);}',
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
fn modelLight(rgb:vec3f,metal:f32,N:vec3f,L:vec3f,energy:f32)->vec3f{
 let diffuse=${MODEL_DIFFUSE};
 let nl=dot(N,L);
 if(surfaceModel==${MODEL_FLAG.toon}u){return diffuse*${TOON_BANDS};}
 return diffuse*${DIFFUSE_COSINE};
}`,
)

/**
 * The unlit models in the surface pass: the view basis read off the view-projection (its first two
 * rows are the camera's right and up, up to the projection's scale), the view-space normal, then
 * the colour each shows. `depth` is the ramp of `writeDepthRamp` (`../../camera/depthConvention.ts`):
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
