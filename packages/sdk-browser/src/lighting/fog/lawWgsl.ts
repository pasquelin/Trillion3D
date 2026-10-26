import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FOG_SLOT } from '../../../../sdk-core/src/scene/core/fog.ts'

/**
 * THE HEIGHT FOG'S LAW, written once for the two evaluations of it: the analytic fog
 * (`../fogShader.ts`), which integrates it along a ray in closed form, and the volume's cells
 * (`./gridWgsl.ts`), which read it at a point and sum it along a column (`./integrateWgsl.ts`).
 *
 * The density of a layer — `layer` is its `baseDensity, falloff, baseHeight` — at the height `z` is
 * `baseDensity · 2^(−falloff · (z − baseHeight))` (`fogLayerDensity`); the medium's density at a
 * height is the first layer's and the second's summed (`fogDensityAt`, the fog block of the light
 * buffer). The exponent is held to `[lowest, highest]`: the analytic fog holds it where a ray starts
 * so that no exponent leaves what a 32-bit float holds, the volume reads it as it is.
 *
 * What a density becomes is the two evaluations' own, as the engines that fixed them have it: the
 * analytic fog reads it as the exponent of two, a transmittance `2^(−X)` where `X` is `ln 2` times
 * the line integral of the density — a uniform medium extinguishes at `(ln 2)² · density` per
 * metre —, the volume as an extinction of half the density (`FOG_HALF_DENSITY`), per metre. Half
 * is `(ln 2)²` to within 4.07 %: the optical depth of a ray is `0.5 / (ln 2)²` times the analytic fog's in
 * the volume, whatever the falloff, which a test holds them to (`fogIntegrate.test.ts`).
 */
export const FOG_LAW_WGSL = wgslBlock(
  'FOG_LAW_WGSL',
  [],
  `
const FOG_LN2:f32=${Math.LN2};
/** The share of the density the volume reads as its extinction, per metre. */
const FOG_HALF_DENSITY:f32=0.5;
/** The bounds of an exponent that is not held. */
const FOG_NO_BOUND:f32=3.0e38;
fn fogLayerDensity(layer:vec4f,z:f32,lowest:f32,highest:f32)->f32{
 return layer.x*exp2(clamp(-layer.y*(z-layer.z),lowest,highest));
}
fn fogDensityAt(z:f32)->f32{
 return fogLayerDensity(directLights.fog[${FOG_SLOT.law}],z,-FOG_NO_BOUND,FOG_NO_BOUND)
  +fogLayerDensity(directLights.fog[${FOG_SLOT.second}],z,-FOG_NO_BOUND,FOG_NO_BOUND);
}`,
)
