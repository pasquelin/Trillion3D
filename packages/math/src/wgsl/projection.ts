import { wgslFn } from './decl.ts'

/**
 * Between pixels, normalised device coordinates and the world, as the shaders compute it: `y`
 * grows down the screen and up in device coordinates. One way each: a pixel to device coordinates
 * divides by the size (`pixelToNdc`), device coordinates to a pixel flip `y` as `½ − y·½`, one
 * rounding after an exact halving (`ndcToPixel`, which `clipToFramebuffer` calls).
 */

export const uvToNdc = wgslFn(
  'uvToNdc',
  [],
  'fn uvToNdc(uv:vec2f)->vec2f{return vec2f(uv.x*2.0-1.0,1.0-uv.y*2.0);}',
)

/** A pixel to device coordinates: its texture coordinates (`pixel / size`) through `uvToNdc`. */
export const pixelToNdc = wgslFn(
  'pixelToNdc',
  [uvToNdc],
  'fn pixelToNdc(pixel:vec2f,size:vec2f)->vec2f{return uvToNdc(pixel/size);}',
)

/** The three first lanes of the homogeneous `h`, each divided by its `w`. */
export const perspectiveDivide = wgslFn(
  'perspectiveDivide',
  [],
  'fn perspectiveDivide(h:vec4f)->vec3f{return h.xyz/h.w;}',
)

/** Normalised device coordinates to texture coordinates, `y` flipped: `(½ + x·½, ½ − y·½)`, one
 *  rounding after an exact halving. */
export const ndcToUv = wgslFn(
  'ndcToUv',
  [],
  'fn ndcToUv(c:vec2f)->vec2f{return vec2f(0.5,-0.5)*c+0.5;}',
)

/** Device coordinates to a pixel: their texture coordinates (`ndcToUv`) times the size. */
export const ndcToPixel = wgslFn(
  'ndcToPixel',
  [ndcToUv],
  'fn ndcToPixel(ndc:vec2f,size:vec2f)->vec2f{return ndcToUv(ndc)*size;}',
)

/** The pixel of the clip point `clip` (`ndcToPixel`), its depth beside; on the CPU,
 *  `clipToPixel` (`../projection/clip.ts`). */
export const clipToFramebuffer = wgslFn(
  'clipToFramebuffer',
  [perspectiveDivide, ndcToPixel],
  `fn clipToFramebuffer(clip:vec4f,size:vec2f)->vec3f{
 let ndc=perspectiveDivide(clip);
 return vec3f(ndcToPixel(ndc.xy,size),ndc.z);
}`,
)

/** The texture coordinates of the clip point `clip`: `ndcToUv` of its division by `w`. */
export const clipToUv = wgslFn(
  'clipToUv',
  [perspectiveDivide, ndcToUv],
  'fn clipToUv(clip:vec4f)->vec2f{return ndcToUv(perspectiveDivide(clip).xy);}',
)

/** Normalised device coordinates to texture coordinates, y kept up: a projection that already
 *  flips it. */
export const ndcToUvUnflipped = wgslFn(
  'ndcToUvUnflipped',
  [],
  'fn ndcToUvUnflipped(ndc:vec2f)->vec2f{return ndc*0.5+vec2f(0.5);}',
)

/** The homogeneous image of the point `p`, no division (`../vector/vector.ts`). */
export const transformHomogeneousPoint = wgslFn(
  'transformHomogeneousPoint',
  [],
  'fn transformHomogeneousPoint(m:mat4x4f,p:vec3f)->vec4f{return m*vec4f(p,1.0);}',
)

/** The image of the point `p` under `m`, its `xyz` taken as is (no division): an affine map's point. */
export const transformPoint = wgslFn(
  'transformPoint',
  [transformHomogeneousPoint],
  'fn transformPoint(m:mat4x4f,p:vec3f)->vec3f{return transformHomogeneousPoint(m,p).xyz;}',
)

export const unprojectPoint = wgslFn(
  'unprojectPoint',
  [transformHomogeneousPoint, perspectiveDivide],
  `fn unprojectPoint(inverseViewProjection:mat4x4f,ndc:vec3f)->vec3f{
 let point=transformHomogeneousPoint(inverseViewProjection,ndc);
 return perspectiveDivide(point);
}`,
)

/** Whether the projection a screen slab describes is a perspective: its word `w`, one under a
 *  perspective, zero under an orthographic projection. Every reader of that word. */
export const slabPerspective = wgslFn(
  'slabPerspective',
  [],
  'fn slabPerspective(slab:vec4f)->bool{return slab.w>0.5;}',
)
