/**
 * The sRGB encode, linear to display: `12.92·C` at and under 0.0031308,
 * `1.055·C^(1/2.4) − 0.055` above — the CPU's `linearToSrgb` (sdk-core `math/primitives/color.ts`)
 * — written once, so two programs never encode one colour apart.
 *
 * The exponent is the f32 nearest 1/2.4, written with the nine digits that name it: a rounded
 * 0.41666 strays from the definition by up to 6.2e-6 on [0, 1], this one
 * by the f32 rounding alone (2.7e-7, `pow` included). A negative input takes the linear branch;
 * `max` keeps the other branch's `pow` defined, whose value the select drops.
 */
export const SRGB_ENCODE_WGSL = `
fn linearToSrgb(c:vec3f)->vec3f{
 let curve=1.055*pow(max(c,vec3f(0.0)),vec3f(0.416666667))-0.055;
 return select(curve,c*12.92,c<=vec3f(0.0031308));
}`
