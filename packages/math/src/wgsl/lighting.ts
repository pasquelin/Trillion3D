import { wgslConst, wgslFn } from './decl.ts'
import { INVERSE_PI, PI } from './constants.ts'
import { wgslF32 } from './number.ts'

/**
 * The standard material's terms, as the lights, the mirror and the area lights compute them.
 * Where two shaders write one term in two operation orders — the diffuse albedo divided by π or
 * multiplied by 1/π, α² as `(r·r)·(r·r)` or `((r·r)·r)·r`, N·V floored or clamped — each order
 * rounds its own way and is its own declaration. The paired α² `(r·r)·(r·r)` stays in its shaders
 * (`standardLighting.ts`, `ggxSampleWgsl.ts`, `coneShader.ts`): each one sums its last product
 * there (`1 − α²`, `α² − 1`, `1 + α²`), a sum the compiler may fuse with it, and a call returning
 * α² would round it apart.
 */

// sdk-browser/src/lighting/standardLighting.ts
export const DIELECTRIC_F0 = wgslConst('DIELECTRIC_F0', [], 'const DIELECTRIC_F0=vec3f(0.04);')

// sdk-browser/src/lighting/standardLighting.ts
export const fresnelSchlick = wgslFn(
  'fresnelSchlick',
  [],
  'fn fresnelSchlick(f0:vec3f,cosine:f32)->vec3f{let x=clamp(1.0-cosine,0.0,1.0);let x2=x*x;return f0+(vec3f(1.0)-f0)*(x2*x2*x);}',
)

// sdk-browser/src/lighting/standardLighting.ts
export const fresnelScalar = wgslFn(
  'fresnelScalar',
  [],
  'fn fresnelScalar(f0:f32,cosine:f32)->f32{let x=clamp(1.0-cosine,0.0,1.0);let x2=x*x;return f0+(1.0-f0)*(x2*x2*x);}',
)

// sdk-browser/src/lighting/standardLighting.ts, lighting/direct/rectLightWgsl.ts, reflections/modelShader.ts
export const f0Of = wgslFn(
  'f0Of',
  [DIELECTRIC_F0],
  'fn f0Of(rgb:vec3f,metal:f32)->vec3f{return mix(DIELECTRIC_F0,rgb,metal);}',
)

// sdk-browser/src/lighting/standardLighting.ts, divided by π
export const lambertAlbedo = wgslFn(
  'lambertAlbedo',
  [PI],
  'fn lambertAlbedo(rgb:vec3f,metal:f32)->vec3f{return rgb*(1.0-metal)/PI;}',
)

// sdk-browser/src/bounce/gridWgsl.ts: the bounce passes' 1/π, one ulp above `INVERSE_PI` by design:
// merged, every bounced pixel would move by that ulp, an image change, never a refactor. Its value
// is the f32 the shaders' literal `0.31830989` names, written by the one number writer.
export const INVERSE_PI_BOUNCE = wgslConst(
  'INVERSE_PI_BOUNCE',
  [],
  `const INVERSE_PI_BOUNCE:f32=${wgslF32(0.31830989)};`,
)

// sdk-browser/src/scene/surfaceModel.ts, lighting/direct/rectLightWgsl.ts, lobesWgsl.ts, times 1/π
export const lambertAlbedoMul = wgslFn(
  'lambertAlbedoMul',
  [INVERSE_PI],
  'fn lambertAlbedoMul(rgb:vec3f,metal:f32)->vec3f{return rgb*(1.0-metal)*INVERSE_PI;}',
)

// sdk-browser/src/lighting/direct/rectLightWgsl.ts, reflections/modelShader.ts
export const splitSumTerm = wgslFn(
  'splitSumTerm',
  [],
  'fn splitSumTerm(f0:vec3f,t:vec4f)->vec3f{return f0*t.x+(vec3f(1.0)-f0)*t.y;}',
)

// sdk-browser/src/reflections/bandsShader.ts, left to right
export const roughnessToAlpha2Chain = wgslFn(
  'roughnessToAlpha2Chain',
  [],
  'fn roughnessToAlpha2Chain(rough:f32)->f32{return rough*rough*rough*rough;}',
)

// sdk-browser/src/lighting/standardLighting.ts, lighting/direct/lobesWgsl.ts
export const ndotvFloor = wgslFn(
  'ndotvFloor',
  [],
  'fn ndotvFloor(N:vec3f,V:vec3f)->f32{return max(dot(N,V),1e-4);}',
)

// sdk-browser/src/lighting/direct/rectLightWgsl.ts, reflections/modelShader.ts
export const ndotvClamped = wgslFn(
  'ndotvClamped',
  [],
  'fn ndotvClamped(N:vec3f,V:vec3f)->f32{return clamp(dot(N,V),1e-4,1.0);}',
)
