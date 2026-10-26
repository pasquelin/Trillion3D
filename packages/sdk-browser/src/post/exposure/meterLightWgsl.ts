import { wgslFn } from '../../../../math/src/wgsl/decl.ts'

/**
 * `meterLight(colour, weights, preScale, floor)`: the luminance the meter reads of a pixel's
 * colour — the one reading the histogram's measure and the basic method's setup share. The colour is
 * radiance as the composition reads it, its red, green and blue as they are, times `preScale`, the reciprocal of the
 * pre-exposure the image holds its light multiplied by; the luminance is its dot product with the
 * channels' `weights`, no lower than `floor`.
 */
export const METER_LIGHT_WGSL = wgslFn(
  'meterLight',
  [],
  `fn meterLight(colour:vec4f,weights:vec3f,preScale:f32,floor:f32)->f32{
 return max(dot(colour.rgb*preScale,weights),floor);
}`,
)
