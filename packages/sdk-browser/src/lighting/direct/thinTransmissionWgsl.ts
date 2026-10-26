import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { GGX_DISTRIBUTION_WGSL } from '../standardLighting.ts'

/**
 * A THIN TWO-SIDED SURFACE'S TRANSMISSION of one light (`thinTransmission`): the share of the
 * light's energy at the point (its intensity through its falloff, range and shadow, before the
 * subsurface colour) that the sheet gives to the eye, a product of two lobes of the light's
 * direction `L` (unit, toward it) with the normal `N` and the view `V` (unit, toward the eye):
 * - a wrapped cosine, `(1/2 − N·L) / (3/2)²` held to [0, 1], 2/3 for a light straight behind, down to
 *   nothing at a cosine of one half in front: the sheet takes light from its back and, past the
 *   horizon, from its front;
 * - a broad GGX lobe (α² = 0.36) in the cosine of the angle between the view and the opposite of
 *   the light, `−V·L` held to [0, 1]: the sheet is brightest seen against the light.
 * Their product is the term as it stands, with no 1/π and no cosine factor: its peak is 0.589, a
 * light behind the sheet and the eye on its line. The surface's subsurface colour weighs it per
 * channel (`declaredLightWgsl`). The same term serves every light (point, spot, sun, rectangle),
 * its direction the one toward the light's centre.
 */
export const THIN_TRANSMISSION_WGSL = wgslBlock(
  'THIN_TRANSMISSION_WGSL',
  [GGX_DISTRIBUTION_WGSL],
  `
fn thinTransmission(N:vec3f,V:vec3f,L:vec3f)->f32{
 let wrapped=saturate((0.5-dot(N,L))/2.25);
 let against=saturate(-dot(V,L));
 return wrapped*ggxDistribution(0.36,against,1.0-against*against);
}`,
)
