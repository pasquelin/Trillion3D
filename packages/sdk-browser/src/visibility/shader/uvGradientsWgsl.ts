import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * Screen gradients (per pixel in x, then y) of a coordinate of vertex values `uva..uvc` at a pixel,
 * from the steps `dx` and `dy` of its perspective-correct weights (`pixelBarycentric`): the
 * derivatives a fragment reads, exact at the pixel. Zero where the weights' steps are.
 * `uvDerivatives` (`../uvDerivatives.fixture.ts`) is its CPU mirror.
 */
export const UV_GRADIENTS_WGSL = wgslBlock(
  'UV_GRADIENTS_WGSL',
  [],
  `fn uvGradients(dx:vec3f,dy:vec3f,uva:vec2f,uvb:vec2f,uvc:vec2f)->mat2x2f{
 return mat2x2f(uva*dx.x+uvb*dx.y+uvc*dx.z,uva*dy.x+uvb*dy.y+uvc*dy.z);
}`,
)
