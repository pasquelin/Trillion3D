import { wgslFn } from './decl.ts'

/**
 * Where a shader samples: a seed folded into [0, 1), the interleaved gradient of a pixel, the
 * bilinear combine of four taps already read, and the greatest channel of a colour. The combine
 * holds no load: each shader reads its four taps its own way, and only the `mix` of `mix` is
 * common, one declaration per type.
 */

export const hashUnit = wgslFn(
  'hashUnit',
  [],
  `fn hashUnit(seed:u32)->f32{
 var x=seed*747796405u+2891336453u;
 x=((x>>((x>>28u)+4u))^x)*277803737u;
 x=(x>>22u)^x;
 return f32(x)*2.3283064e-10;
}`,
)

/** Interleaved gradient noise at screen point `p`, in [0, 1): a fractional part of a linear
 *  function of the pixel, which spreads its values evenly over neighbouring pixels, where a program
 *  dithers — a shadow's rays, a blended mirror's march.
 *
 *  The three numbers, declared: they stand for the pattern's steps, not for a quantity of the
 *  scene. One pixel along x moves the value by 52.9829189 × 0.06711056 = 3.5557, 0.556 once
 *  wrapped, one along y by 0.309, and the inner wrap, every 14.9 pixels along x and 171 along y,
 *  adds 53 − 52.9829189 = 0.017. With those steps the nine values of any 3 × 3 block of pixels
 *  leave no gap wider than 0.14 of [0, 1) on a 4096 × 2304 screen in f32, where an even spread
 *  leaves 1/9 = 0.11 and nine independent draws 0.31 on average. Sensitivity: every dithered
 *  pixel reads them, so another digit moves the pixels of every ray rotation and mirror march: an
 *  image change, never a refactor. */
export const interleavedGradient = wgslFn(
  'interleavedGradient',
  [],
  'fn interleavedGradient(p:vec2f)->f32{return fract(52.9829189*fract(dot(p,vec2f(0.06711056,0.00583715))));}',
)

// sdk-browser/src/lighting/direct/rectLightWgsl.ts (`ltcLookup`)
export const bilinear4 = wgslFn(
  'bilinear4',
  [],
  'fn bilinear4(a:vec4f,b:vec4f,c:vec4f,d:vec4f,f:vec2f)->vec4f{return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}',
)

// sdk-browser/src/vsm/transmissionWgsl.ts
export const bilinear3 = wgslFn(
  'bilinear3',
  [],
  'fn bilinear3(a:vec3f,b:vec3f,c:vec3f,d:vec3f,f:vec2f)->vec3f{return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}',
)

// sdk-browser/src/lighting/toneMappingWgsl.ts, reflections/resolveWgsl.ts
export const maxChannel = wgslFn(
  'maxChannel',
  [],
  'fn maxChannel(c:vec3f)->f32{return max(c.r,max(c.g,c.b));}',
)
