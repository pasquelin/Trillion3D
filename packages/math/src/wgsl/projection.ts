import { wgslFn } from './decl.ts'

/**
 * Between pixels, normalised device coordinates and the world, as the shaders compute it: `y`
 * grows down the screen and up in device coordinates. One way each: a pixel to device coordinates
 * divides by the size (`pixelToNdc`), device coordinates to a pixel flip `y` as `½ − y·½`, one
 * rounding after an exact halving (`ndcToPixel`, which `clipToFramebuffer` calls).
 */

export const pixelToNdc = wgslFn(
  'pixelToNdc',
  [],
  'fn pixelToNdc(pixel:vec2f,size:vec2f)->vec2f{return vec2f(pixel.x/size.x*2.0-1.0,1.0-pixel.y/size.y*2.0);}',
)

export const uvToNdc = wgslFn(
  'uvToNdc',
  [],
  'fn uvToNdc(uv:vec2f)->vec2f{return vec2f(uv.x*2.0-1.0,1.0-uv.y*2.0);}',
)

/** The three first lanes of the homogeneous `h`, each divided by its `w`. */
export const perspectiveDivide = wgslFn(
  'perspectiveDivide',
  [],
  'fn perspectiveDivide(h:vec4f)->vec3f{return h.xyz/h.w;}',
)

export const ndcToPixel = wgslFn(
  'ndcToPixel',
  [],
  'fn ndcToPixel(ndc:vec2f,size:vec2f)->vec2f{return vec2f((ndc.x*0.5+0.5)*size.x,(0.5-ndc.y*0.5)*size.y);}',
)

/** The pixel of the clip point `clip` (`ndcToPixel`), its depth beside. */
export const clipToFramebuffer = wgslFn(
  'clipToFramebuffer',
  [perspectiveDivide, ndcToPixel],
  `fn clipToFramebuffer(clip:vec4f,size:vec2f)->vec3f{
 let ndc=perspectiveDivide(clip);
 return vec3f(ndcToPixel(ndc.xy,size),ndc.z);
}`,
)

export const clipToUv = wgslFn(
  'clipToUv',
  [],
  'fn clipToUv(clip:vec4f)->vec2f{return vec2f(clip.x/clip.w*0.5+0.5,0.5-clip.y/clip.w*0.5);}',
)

/** `y` kept: a projection that already flips it. */
/** Normalised device coordinates to texture coordinates, y kept up. */
export const ndcToUvUnflipped = wgslFn(
  'ndcToUvUnflipped',
  [],
  'fn ndcToUvUnflipped(ndc:vec2f)->vec2f{return ndc*0.5+vec2f(0.5);}',
)

export const ndcToUv = wgslFn(
  'ndcToUv',
  [],
  'fn ndcToUv(c:vec2f)->vec2f{return vec2f(0.5,-0.5)*c+0.5;}',
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
  [],
  'fn transformPoint(m:mat4x4f,p:vec3f)->vec3f{return (m*vec4f(p,1.0)).xyz;}',
)

export const unprojectPoint = wgslFn(
  'unprojectPoint',
  [transformHomogeneousPoint, perspectiveDivide],
  `fn unprojectPoint(inverseViewProjection:mat4x4f,ndc:vec3f)->vec3f{
 let point=transformHomogeneousPoint(inverseViewProjection,ndc);
 return perspectiveDivide(point);
}`,
)
