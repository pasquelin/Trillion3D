import { DEFERRED_BINDINGS } from '../../lighting/deferred/bindings.ts'
import type { VisMaterial } from '../../visibility/materialType.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { octDecode, octEncode } from '../../../../math/src/wgsl/octahedral.ts'
import { loadOnlyTarget } from '../../gpu/core/loadOnlyTarget.ts'

/**
 * The physical material's extra lobes, as the Khronos material extensions name them: an
 * anisotropic GGX specular (`anisotropy`, `anisotropyRotation`, `anisotropyMap`), a dielectric
 * clear coat over the base (`clearcoat`, `clearcoatRoughness`, their maps and the coat's own
 * normal map) and the cloth shading model (`sheen`, `sheenColor`, `sheenRoughness` and their
 * maps): the fuzz colour of an inverse-GGX lobe, weighed by the cloth amount against the
 * standard specular lobe, and added to the diffuse colour of the indirect light. A cloth takes the
 * place of the coat and the anisotropy — the cloth model has neither — and a surface that
 * transmits or wears a coat is not a cloth. The opaque resolve reads them per pixel
 * (`../../visibility/shader/physicalWgsl.ts`) and leaves them in one texel of the lobes target,
 * under `PHYSICAL_SURFACE_FLAG`; the lighting reads that texel under the same bit
 * (`../../lighting/direct/lobesWgsl.ts`). A surface without a lobe marks nothing and the lighting
 * runs its standard lobe, operand for operand. A pixel's coat is a lobe whose weight is its
 * factor: the lighting shades the pixel as the clear coat model does (`../../lighting/direct/clearCoatWgsl.ts`).
 */
export const PHYSICAL_SURFACE_FLAG = 64
/** The last word of a cloth's texel of the lobes target: the float −0, which a coat roughness never is. */
const CLOTH_MARK = 0x80000000
/** One texel a pixel: the anisotropy direction and the coat normal (octahedral, two signed
 *  halves each), the anisotropy strength and the coat factor (two unsigned halves), the coat
 *  roughness (a float's bits). A cloth's texel is marked by its last word, `CLOTH_MARK` — no coat
 *  roughness has that value, the float −0 — and holds its fuzz colour and cloth amount in four
 *  halves, the first two words. */
export const PHYSICAL_LOBES_FORMAT: GPUTextureFormat = 'rgba32uint'
/** The lighting's read of the lobes target, by load alone: the opaque resolve's
 *  (`../../lighting/direct/lobesWgsl.ts`); its bytes, one texel per pixel when wanted, a
 *  1×1 placeholder otherwise (`bytes`). */
export const PHYSICAL_LOBES_TARGET = loadOnlyTarget(
  DEFERRED_BINDINGS.lobes,
  PHYSICAL_LOBES_FORMAT,
  'physicalLobes',
)
/** The fields `hasCloth` and the lobe predicates read. */
type LobeFacts = Pick<
  VisMaterial,
  | 'lit'
  | 'anisotropy'
  | 'clearcoat'
  | 'graph'
  | 'sheen'
  | 'sheenRoughness'
  | 'sheenRoughnessMap'
  | 'specularIntensity'
>

/** Whether a surface wears the cloth shading model with something to show: the model switched on
 *  (`sheen`, which the surface record leaves above zero only where no clear coat and no
 *  transmission takes the surface first) and a cloth amount above zero — the sheen roughness, or
 *  its map, which scales it —; a graph computes the lobes of a surface that wears one. */
const hasCloth = (mat: LobeFacts) =>
  mat.lit &&
  !mat.graph &&
  (mat.sheen ?? 0) > 0 &&
  ((mat.sheenRoughness ?? 0) > 0 || !!mat.sheenRoughnessMap)

/** Whether a surface has an anisotropic lobe or a cloth's: a strength above zero — the maps scale
 *  it, so without one there is nothing to scale — or a cloth amount (`hasCloth`), or, on a surface
 *  that wears a graph, which computes them in place of its factors, a graph that wires one. */
const skewedOrCloth = (mat: LobeFacts) =>
  mat.graph
    ? !!(mat.graph.outputs.anisotropy || mat.graph.outputs.cloth)
    : (mat.anisotropy ?? 0) > 0 || hasCloth(mat)
/** Whether a surface has a clear coat: a coat above zero, or a graph that wires one. */
const coated = (mat: LobeFacts) =>
  mat.graph ? !!mat.graph.outputs.clearCoat : (mat.clearcoat ?? 0) > 0

/** Whether a surface has a lobe to set: an anisotropic one, a coat or a cloth's. */
const hasLobe = (mat: LobeFacts) => mat.lit && (skewedOrCloth(mat) || coated(mat))

/** Whether a surface reads a record of lobes: it has a lobe (`hasLobe`), or it declares a specular
 *  (`specularIntensity`), which the record carries beside the lobes and a pixel's flags take. What
 *  its pixels' resolve and blend fragments read, whatever the surfaces' format. */
export const hasPhysicalLobes = (mat: LobeFacts) =>
  hasLobe(mat) || (mat.lit && !mat.graph && mat.specularIntensity !== undefined)

/** Whether the lighting of a surface may need a lobe: it has one (`hasLobe`). A specular alone is no lobe. */
export const hasLightingLobes = (mat: LobeFacts) => hasLobe(mat)

/** A unit vector to two signed halves and back, octahedral (`octEncode`, `octDecode` of the maths
 *  library): what the resolve stores and the lighting reads of the anisotropy direction and the
 *  coat normal. A fragment: its host lists it. */
export const LOBE_PACK_WGSL = wgslBlock(
  'LOBE_PACK_WGSL',
  [octEncode, octDecode],
  `fn lobeOctEncode(n:vec3f)->u32{return pack2x16snorm(octEncode(n));}
fn lobeOctDecode(word:u32)->vec3f{return octDecode(unpack2x16snorm(word));}
/** A cloth's texel: the fuzz colour and the cloth amount as four halves, no strength, no coat. */
fn clothTexel(fuzz:vec3f,cloth:f32)->vec4u{
 return vec4u(pack2x16float(fuzz.rg),pack2x16float(vec2f(fuzz.b,cloth)),0u,${CLOTH_MARK}u);
}
fn lobeIsCloth(w:vec4u)->bool{return w.w==${CLOTH_MARK}u;}
fn packedFuzz(w:vec4u)->vec3f{return vec3f(unpack2x16float(w.x),unpack2x16float(w.y).x);}
fn packedCloth(w:vec4u)->f32{return unpack2x16float(w.y).y;}`,
)
