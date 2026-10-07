import { wgslFn } from './decl.ts'

/**
 * Between pixels, normalised device coordinates and the world, as the shaders compute it: `y`
 * grows down the screen and up in device coordinates. The shaders flip `y` in three orders —
 * `1 − (y·½ + ½)`, `−y·½ + ½` and `½ − y·½` — and divide by the size or multiply by its
 * reciprocal; each order rounds its own way, so each is its own declaration.
 */

// sdk-browser/src/lighting/deferred/shaders.ts, visibility/shader/materialTilesWgsl.ts
export const pixelToNdc = wgslFn(
  'pixelToNdc',
  [],
  'fn pixelToNdc(pixel:vec2f,size:vec2f)->vec2f{return vec2f(pixel.x/size.x*2.0-1.0,1.0-pixel.y/size.y*2.0);}',
)

// sdk-browser/src/taa/shaderWgsl.ts, the size's reciprocal
export const pixelToNdcInv = wgslFn(
  'pixelToNdcInv',
  [],
  'fn pixelToNdcInv(pixel:vec2f,inverseSize:vec2f)->vec2f{return vec2f(pixel.x*inverseSize.x*2.0-1.0,1.0-pixel.y*inverseSize.y*2.0);}',
)

// sdk-browser/src/vsm/projectionWgsl.ts, lighting/tiles/boundsWgsl.ts
export const uvToNdc = wgslFn(
  'uvToNdc',
  [],
  'fn uvToNdc(uv:vec2f)->vec2f{return vec2f(uv.x*2.0-1.0,1.0-uv.y*2.0);}',
)

// sdk-browser/src/gpu/raster/contract.ts (`screen`)
export const clipToPixel = wgslFn(
  'clipToPixel',
  [],
  'fn clipToPixel(p:vec4f,size:vec2f)->vec2f{return vec2f((p.x/p.w*0.5+0.5)*size.x,(1.0-(p.y/p.w*0.5+0.5))*size.y);}',
)

// sdk-browser/src/visibility/shader/pixelTriangleWgsl.ts (`framebuffer`)
export const clipToFramebuffer = wgslFn(
  'clipToFramebuffer',
  [],
  `fn clipToFramebuffer(clip:vec4f,size:vec2f)->vec3f{
 let ndc=clip.xyz/clip.w;
 return vec3f((ndc.x*0.5+0.5)*size.x,(-ndc.y*0.5+0.5)*size.y,ndc.z);
}`,
)

// sdk-browser/src/webgpu/water/transmittedWgsl.ts
export const ndcToPixel = wgslFn(
  'ndcToPixel',
  [],
  'fn ndcToPixel(ndc:vec2f,size:vec2f)->vec2f{return vec2f((ndc.x*0.5+0.5)*size.x,(0.5-ndc.y*0.5)*size.y);}',
)

// sdk-browser/src/taa/shaderWgsl.ts
export const clipToUv = wgslFn(
  'clipToUv',
  [],
  'fn clipToUv(clip:vec4f)->vec2f{return vec2f(clip.x/clip.w*0.5+0.5,0.5-clip.y/clip.w*0.5);}',
)

// sdk-browser/src/webgpu/blend/displayFilterWgsl.ts
export const ndcToUv = wgslFn(
  'ndcToUv',
  [],
  'fn ndcToUv(c:vec2f)->vec2f{return vec2f(0.5,-0.5)*c+0.5;}',
)

// sdk-browser/src/taa/shaderWgsl.ts, no division (`../vector/vector.ts`), called by
// `unprojectPoint` alone
const transformHomogeneousPoint = wgslFn(
  'transformHomogeneousPoint',
  [],
  'fn transformHomogeneousPoint(m:mat4x4f,p:vec3f)->vec4f{return m*vec4f(p,1.0);}',
)

// sdk-browser/src/lighting/tiles/boundsWgsl.ts (`unproject`), lighting/deferred/shaders.ts
export const unprojectPoint = wgslFn(
  'unprojectPoint',
  [transformHomogeneousPoint],
  `fn unprojectPoint(inverseViewProjection:mat4x4f,ndc:vec3f)->vec3f{
 let point=transformHomogeneousPoint(inverseViewProjection,ndc);
 return point.xyz/point.w;
}`,
)
