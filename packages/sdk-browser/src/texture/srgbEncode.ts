/**
 * The sRGB encode, linear to display: `12.92·C` at and under 0.0031308,
 * `1.055·C^(1/2.4) − 0.055` above — the CPU's `linearToSrgb` (sdk-core `math/primitives/color.ts`)
 * — written once for both shader languages, so two programs never encode one colour apart.
 *
 * The exponent is the f32 nearest 1/2.4, written with the nine digits that name it: the rounded
 * 0.41666 the host library writes strays from the definition by up to 6.2e-6 on [0, 1], this one
 * by the f32 rounding alone (2.7e-7, `pow` included). A negative input takes the linear branch;
 * `max` keeps the other branch's `pow` defined, whose value the select drops.
 */
const THRESHOLD = '0.0031308',
  SLOPE = '12.92',
  EXPONENT = '0.416666667',
  SCALE = '1.055',
  OFFSET = '0.055';

export const SRGB_ENCODE_WGSL = `fn linearToSrgb(c:vec3f)->vec3f{return select(${SCALE}*pow(max(c,vec3f(0.0)),vec3f(${EXPONENT}))-${OFFSET},c*${SLOPE},c<=vec3f(${THRESHOLD}));}`;

export const SRGB_ENCODE_GLSL = `vec3 linearToSrgb(vec3 x){bvec3 low=lessThanEqual(x,vec3(${THRESHOLD}));return mix(${SCALE}*pow(max(x,vec3(0.0)),vec3(${EXPONENT}))-${OFFSET},${SLOPE}*x,low);}`;
