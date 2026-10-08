import type { VisMaterial } from '../visibility/materialType.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { octDecode, octEncode } from '../../../math/src/wgsl/octahedral.ts'
import { loadOnlyTarget } from '../gpu/core/loadOnlyTarget.ts'

/**
 * The physical material's two extra lobes, as the Khronos material extensions write them: an
 * anisotropic GGX specular (`anisotropy`, `anisotropyRotation`, `anisotropyMap`) and a dielectric
 * clear coat over the base (`clearcoat`, `clearcoatRoughness`, their maps and the coat's own
 * normal map). The opaque resolve reads them per pixel (`../visibility/shader/physicalWgsl.ts`) and
 * leaves them in one texel of the lobes target, under `PHYSICAL_SURFACE_FLAG`; the lighting reads
 * that texel under the same bit (`../lighting/direct/lobesWgsl.ts`). A surface without either
 * lobe marks nothing and the lighting runs its standard lobe, operand for operand.
 */
export const PHYSICAL_SURFACE_FLAG = 64
/** The lighting's binding of the lobes target (`../lighting/deferred/setup.ts`): past 30 and 31,
 *  where the resolve proofs bind their samples and sums. */
export const PHYSICAL_LOBES_BINDING = 32
/** One texel a pixel: the anisotropy direction and the coat normal (octahedral, two signed
 *  halves each), the anisotropy strength and the coat factor (two unsigned halves), the coat
 *  roughness (a float's bits). */
export const PHYSICAL_LOBES_FORMAT: GPUTextureFormat = 'rgba32uint'
/** The lighting's read of the lobes target, by load alone: the opaque resolve's and the water
 *  composite's (`../lighting/direct/lobesWgsl.ts`); its bytes, one texel per pixel when wanted, a
 *  1×1 placeholder otherwise (`bytes`). */
export const PHYSICAL_LOBES_TARGET = loadOnlyTarget(
  PHYSICAL_LOBES_BINDING,
  PHYSICAL_LOBES_FORMAT,
  'physicalLobes',
)
/** Whether a surface carries a lobe beyond the standard one: a strength or a coat above zero —
 *  the maps scale those factors, so without one there is nothing to scale. */
export const hasPhysicalLobes = (mat: Pick<VisMaterial, 'lit' | 'anisotropy' | 'clearcoat'>) =>
  mat.lit && ((mat.anisotropy ?? 0) > 0 || (mat.clearcoat ?? 0) > 0)

/** A unit vector to two signed halves and back, octahedral (`octEncode`, `octDecode` of the maths
 *  library): what the resolve stores and the lighting reads of the anisotropy direction and the
 *  coat normal. A fragment: its host lists it. */
export const LOBE_PACK_WGSL = wgslBlock(
  'LOBE_PACK_WGSL',
  [octEncode, octDecode],
  `fn lobeOctEncode(n:vec3f)->u32{return pack2x16snorm(octEncode(n));}
fn lobeOctDecode(word:u32)->vec3f{return octDecode(unpack2x16snorm(word));}`,
)
