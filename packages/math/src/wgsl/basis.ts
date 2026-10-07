import { wgslFn } from './decl.ts'

/**
 * A unit vector across a direction: the cross product with an axis the direction is not along.
 * Each shader picks its own axes, threshold and order, and each choice turns a frame differently:
 * five formulas, five declarations, none merged into another.
 */

// sdk-browser/src/reflections/traceShader.ts (`reflectionTangent`), inline in reflections/ggxSampleWgsl.ts
export const tangentAround = wgslFn(
  'tangentAround',
  [],
  `fn tangentAround(v:vec3f)->vec3f{
 var axis:vec3f=vec3f(0.0,0.0,1.0);
 if(abs(v.z)>0.999){axis=vec3f(0.0,1.0,0.0);}
 return normalize(cross(axis,v));
}`,
)

// sdk-browser/src/visibility/shader/impostorWgsl.ts (`impFrameX`)
export const tangentImpostor = wgslFn(
  'tangentImpostor',
  [],
  `fn tangentImpostor(n:vec3f)->vec3f{
 let up=select(vec3f(0.0,1.0,0.0),vec3f(0.0,0.0,1.0),abs(n.y)>0.999);
 return normalize(cross(up,n));
}`,
)

// sdk-browser/src/visibility/shader/physicalWgsl.ts, not normalised
export const tangentFallback = wgslFn(
  'tangentFallback',
  [],
  'fn tangentFallback(N:vec3f)->vec3f{return cross(select(vec3f(0.0,1.0,0.0),vec3f(0.0,0.0,1.0),abs(N.z)<0.999),N);}',
)

// sdk-browser/src/webgpu/particles/particlesWgsl.ts
export const tangentBillboard = wgslFn(
  'tangentBillboard',
  [],
  'fn tangentBillboard(toEye:vec3f)->vec3f{return normalize(cross(select(vec3f(0, 1, 0), vec3f(1, 0, 0), abs(toEye.y) > 0.99), toEye));}',
)

// sdk-browser/src/lighting/direct/rectLightWgsl.ts, not normalised
export const tangentSide = wgslFn(
  'tangentSide',
  [],
  'fn tangentSide(N:vec3f)->vec3f{return cross(N,select(vec3f(1.0,0.0,0.0),vec3f(0.0,1.0,0.0),abs(N.x)>0.9));}',
)
