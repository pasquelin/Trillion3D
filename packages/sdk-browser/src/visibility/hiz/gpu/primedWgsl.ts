import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { hizBuildShader } from './shader.ts'

/** The binding of the primed build's uniform, after the three of the build (`hizBindEntries`). */
export const HIZ_PRIMED_BINDING = 3
/** Bytes of the primed uniform: the near plane, the far plane, the projection's weight and the push. */
export const HIZ_PRIMED_BYTES = 16

/**
 * The primed pyramid's level-0 depth (`hizLevel0`, `hizBuildShader`): pushed away. A device depth is
 * turned to the distance it stands for, the push `bias` is added to that distance, and the sum
 * turned back, clamped to [0, 1] — a perspective's depth is `near` over the distance, an
 * orthographic one's is affine from 1 at the near plane to 0 at the far one —; the far plane's zero
 * stays zero. The coarse draw is thus never in front of the image's own surfaces. Its uniform is
 * declared beside the build's.
 */
const HIZ_PRIMED_WGSL = wgslBlock(
  'HIZ_PRIMED_WGSL',
  [],
  `struct Primed{near:f32,far:f32,perspective:f32,bias:f32,}
@group(0) @binding(${HIZ_PRIMED_BINDING}) var<uniform> primed:Primed;
fn hizLevel0(z:f32)->f32{
 if(primed.perspective!=0.0){return saturate(z*primed.near/(primed.near+primed.bias*z));}
 return saturate(z-primed.bias/(primed.far-primed.near));
}`,
)

/** The primed pyramid's shader: the culling build's (`hizBuildShader`) over the pushed level 0. */
export const HIZ_PRIMED_SHADER = /* @__PURE__ */ hizBuildShader(HIZ_PRIMED_WGSL)
