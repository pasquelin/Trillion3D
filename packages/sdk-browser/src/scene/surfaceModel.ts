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
import type { HostShadedMaterial } from '../host/shadedMaterial.ts';
import { INVERSE_PI } from '../lighting/shaderConstants.ts';

export const SURFACE_MODEL = {
  standard: 0,
  diffuse: 1,
  toon: 2,
  normal: 3,
  matcap: 4,
  depth: 5,
} as const;
/** Bits of the page row's flags word that carry the model; below them, the material flags. */
export const MODEL_SHIFT = 17;
/** Surface-buffer flags of the lit models the resolve shades apart: 2 stays the physical one. */
export const MODEL_FLAG = { diffuse: 4, toon: 5 } as const;
/** Surface-buffer flag of a debug view, a normal or depth surface: shown as-is, never fogged,
 *  and composed with neither exposure nor the display curve (`shownAsIs`). */
export const AS_IS_FLAG = 3;

/** The one rule for debug views on both paths: a normal or depth surface is output untouched —
 *  no exposure, no tone mapping —, as the reference never tone maps those two materials. */
export const shownAsIs = (model: number | undefined) =>
  model === SURFACE_MODEL.normal || model === SURFACE_MODEL.depth;

/** The model a surface declares by its family; the physical model otherwise. */
export function hostSurfaceModel({ family }: HostShadedMaterial): number {
  if (family === 'lambert') return SURFACE_MODEL.diffuse;
  if (family === 'toon') return SURFACE_MODEL.toon;
  if (family === 'normal') return SURFACE_MODEL.normal;
  if (family === 'matcap') return SURFACE_MODEL.matcap;
  if (family === 'depth') return SURFACE_MODEL.depth;
  return SURFACE_MODEL.standard;
}

/** Whether a surface carries the metal-rough parameters: a standard or a physical one. */
export const metalRough = ({ family }: HostShadedMaterial) =>
  family === 'standard' || family === 'physical';

/** True when the model is lit by the scene's lights: a Phong material is the standard model. */
export const litModel = (host: HostShadedMaterial, model: number) =>
  model === SURFACE_MODEL.diffuse ||
  model === SURFACE_MODEL.toon ||
  metalRough(host) ||
  host.family === 'phong';

/** The roughness a Blinn–Phong exponent reads as, `√(2 / (n + 2))`: its lobe's width. */
export const shininessRoughness = (shininess: number) =>
  Math.sqrt(2 / (Math.max(0, shininess) + 2));

/**
 * What a declared lamp gives a pixel of a diffuse or toon surface, read by `declaredLight` through
 * the private `surfaceModel` the resolve sets from the surface flag. Toon keeps the lamp's energy —
 * range, cone, shadow — and replaces the cosine by its two bands, 0.7 and 1.
 */
export const SURFACE_MODEL_LIGHT_WGSL = `
var<private> surfaceModel:u32;
fn modelLight(rgb:vec3f,metal:f32,N:vec3f,L:vec3f,energy:f32,ao:f32)->vec3f{
 let diffuse=rgb*(1.0-metal)*${INVERSE_PI}*energy*ao;
 let nl=dot(N,L);
 if(surfaceModel==${MODEL_FLAG.toon}u){return diffuse*mix(0.7,1.0,smoothstep(0.69,0.71,nl*0.5+0.5));}
 return diffuse*max(nl,0.0);
}`;

/**
 * The unlit models in the surface pass: the view basis read off the view-projection (its first two
 * rows are the camera's right and up, up to the projection's scale), the view-space normal, then
 * the colour each shows. `depth` is the ramp of `writeDepthRamp` (`../camera/depthConvention.ts`):
 * white at the camera's near plane, black at its far one, linear in view distance.
 */
export const SURFACE_MODEL_SHADE_WGSL = `
fn viewNormal(N:vec3f)->vec3f{
 let right=normalize(vec3f(uni.viewProj[0].x,uni.viewProj[1].x,uni.viewProj[2].x));
 let up=normalize(vec3f(uni.viewProj[0].y,uni.viewProj[1].y,uni.viewProj[2].y));
 return vec3f(dot(N,right),dot(N,up),dot(N,cross(right,up)));
}
fn matcapUv(N:vec3f)->vec2f{let n=viewNormal(N);return vec2f(n.x*0.495+0.5,0.5-n.y*0.495);}`;
