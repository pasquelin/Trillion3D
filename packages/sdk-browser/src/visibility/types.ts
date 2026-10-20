import type { HostAttributes } from '../session/host/resources.ts'
import type { PageSurface } from '../geometry/pages/surface.ts'
import type { Texture } from '../../../sdk-core/src/texture/contract.ts'
import { VIS_MAX_PAGE_TRIANGLES, VIS_PAGE_ROWS } from './visWords.ts'
import { PAGE_INFO } from './pageInfo.ts'
import { rgbaBytes } from '../materials/texture/imageExtent.ts'
import { wgslFn } from '../../../math/src/wgsl/decl.ts'
import { saturate } from '../../../math/src/scalar/reals.ts'
/** Largest addressable page count: the rows an identifier names (`VIS_PAGE_ROWS`). */
export const VIS_MAX_PAGES = VIS_PAGE_ROWS
/** Rejects a page the identifier cannot address, naming the page so a bad cache is actionable. */
export function assertVisibilityPageTriangles(triangles: number, page?: string) {
  if (!Number.isInteger(triangles) || triangles < 0 || triangles > VIS_MAX_PAGE_TRIANGLES)
    throw new Error(
      `VISIBILITY_PAGE_TRIANGLES: ${triangles} triangles exceed the ${VIS_MAX_PAGE_TRIANGLES} a visibility identifier addresses${page ? ` (${page})` : ''}`,
    )
  return triangles
}
/** Words of a page-table row (`PAGE_INFO`), and its bytes: the stride of the page-table buffer. */
export const ROW_WORDS = PAGE_INFO.words,
  PAGE_INFO_STRIDE = PAGE_INFO.words * 4
/** The high bit of a material word (`PageInfo.material`, a blend item's `material`): the row reads
 *  its geometry as floats and its geometry carries a second UV set, at the tail of the normal atlas
 *  it reads (`vertUv1`, `../geometry/pages/pool/geometryPoolLayout.ts`). A quantized page says so in its
 *  own header. Below it, the rank of its surface's record (`../materials/table/materialTable.ts`). */
export const MATERIAL_SECOND_UV = 0x80000000,
  MATERIAL_RANK_MASK = 0x7fffffff
/** The address bits of `PageInfo.deformOutput`: the results' first word in the float pool plus
 *  one, wherever their source lies (`../deformation/outputs.ts`). */
export const DEFORM_ADDRESS = 0x3fffffff
export const FLAG_LIT = 1,
  FLAG_DOUBLE = 2,
  FLAG_HAS_UV = 4,
  FLAG_HAS_MAP = 8,
  FLAG_HAS_NORMAL = 16,
  /** The row's pool slot holds this cluster's quantized geometry page (`WGP3`), not its index
   *  page: every corner, position and attribute is decoded from those words in place
   *  (`../geometry/cluster/decodeWgsl.ts`). A primitive the compiler gave no geometry page keeps the source
   *  float buffers, and its rows carry this bit at zero. */
  FLAG_CLUSTER_PAGE = 32,
  /** A map of the material has a filter word (`../materials/texture/sampling.ts`): its reads take the
   *  texture's filter rule. Without it, every read is the default one, and nothing else is run. */
  FLAG_SAMPLED = 64,
  FLAG_MASK = 128,
  FLAG_BACK = 256,
  FLAG_HAS_ORM = 512,
  FLAG_HAS_NORMAL_MAP = 1024,
  FLAG_HAS_TANGENT = 2048,
  /** The row's pool slot holds voxel bricks (`../../../sdk-core/src/page/voxelPage.ts`): each
   *  brick draws its box, built from its record in place, and each pixel of it traces the
   *  brick's voxels (`shader/voxelWgsl.ts`); its surface is the voxel's own. */
  FLAG_VOXEL = 4096,
  /** Frame flag, not a material one: the whole frame comes out as raw albedo because no light is
   *  declared, or because the host asked for the unlit view. Only the transparent draw reads it —
   *  the opaque path has its own resolve program for that. */
  FLAG_UNLIT_VIEW = 8192,
  /** The material transmits: the surface reads the already-drawn background instead of blending by alpha. */
  FLAG_TRANSMISSIVE = 16384,
  /** The material reads its vertex colours and the geometry carries some: the base colour is
   *  multiplied by the interpolated vertex colour, as the forward path does. */
  FLAG_HAS_COLOR = 32768,
  /** A blended cluster's shadow-only row (`../geometry/rows/blendCasters.ts`): no depth, only the
   *  transmittance of its surface's coverage (`../lighting/shadows/transmittanceWgsl.ts`). */
  FLAG_BLEND_CASTER = 65536,
  /** Frame flag of the transparent draw: a diagnostic view is shown, the surface's own lighting is
   *  not (`../blend/uniforms.ts`, `diagnosticBits`). */
  FLAG_DIAGNOSTIC_VIEW = 0x40000000
/** Beside it, which view: its code (`DIAGNOSTIC_VIEWS`, `shader/shadeMode.ts`) in the frame flags'
 *  four bits from here, which the transparent pass reads as the resolve reads `uni.mode`: above
 *  every row flag (`FLAG_MAP_UV1` the last), which the frame flags are OR'd with. */
export const DIAGNOSTIC_CODE_SHIFT = 25,
  DIAGNOSTIC_CODE_MASK = 15
/** Fog opt-out above the model bits; a dynamic geometry's row, reactive to the temporal pass (#573);
 *  a row whose surface draws a sprite, or a line of a width other than zero: what every raster
 *  reads its surface's record for (`pageShape`), a row of neither reading none. */
export const FLAG_FOG_FREE = 1 << 20,
  FLAG_DYNAMIC = 1 << 21,
  FLAG_SPRITE = 1 << 22,
  FLAG_LINE = 1 << 23,
  /** A row whose base map reads the second UV set (glTF's `texCoord` 1, `Texture.channel`): what
   *  every vertex stage hands its cutout and transmittance (`pageMaskUv`,
   *  `shader/pageGeometryWgsl.ts`). A row flag alone: a blend item reads its record's `channels`. */
  FLAG_MAP_UV1 = 1 << 24
/** The four bits from here of a row's flags: the most of its history the temporal anti-aliasing
 *  keeps on its surface's pixels (`VisMaterial`'s `historyShare`), as its code
 *  (`historyShareCode`). The opaque passes carry it as they carry a pixel animation, and the
 *  history update caps the history's share by it (`../post/taa/resolveWgsl.ts`); a blend item carries
 *  it in its record's own bits (`ITEM_HISTORY_SHIFT`), its layers writing what they give up of the
 *  history into a target of their own (`GIVEN_UP_TARGET`). The blend pass's frame flags hold their
 *  diagnostic code at these bits, a word a row's flags reach through `ITEM_FLAG_BITS` alone, its
 *  low sixteen bits. Bits 17 to 19 are the surface model's (`MODEL_SHIFT`), 20 to 24 the flags
 *  above, 29 and up free. */
export const HISTORY_SHARE_SHIFT = 25,
  HISTORY_SHARE_MASK = 15
/** The code's steps: a share is a whole number of twelfths of history, so 1, 0.75, 0.5, 0.25 and 0
 *  are exact; code 0 the whole history, the engine's own blend, `HISTORY_SHARE_STEPS` none. */
export const HISTORY_SHARE_STEPS = 12
/** The history share's code (`HISTORY_SHARE_SHIFT`), the nearest twelfth of what it gives up. */
export const historyShareCode = (share = 1) =>
  Math.round((1 - saturate(share)) * HISTORY_SHARE_STEPS)
/** What a history share code gives up of the history, in [0, 1] (`historyShareCode` undone): the
 *  one decode the history update (`../post/taa/resolveWgsl.ts`) and the transparents
 *  (`../blend/vertexReadsWgsl.ts`) read. */
export const HISTORY_GIVEN_UP_WGSL = wgslFn(
  'historyGivenUp',
  [],
  `fn historyGivenUp(code:u32)->f32{return f32(code&${HISTORY_SHARE_MASK}u)/${HISTORY_SHARE_STEPS}.0;}`,
)
export type VisPage = {
  array: Uint32Array
  attributes: HostAttributes
  /** The engine's surface record, read once at the boundary (`../geometry/pages/surface.ts`). */
  material: PageSurface
  clusterId?: string
}

/** Why raw texels cannot be read as `textureRgba` reads them — one byte per channel of four, as
 *  many as the size holds —, or nothing when they can: a gate names the storage, never draws it
 *  blank. */
const texelsReason = ({ format, image }: { format: string; image: unknown }) => {
  if (format !== 'rgba') return `texel format ${format} is unsupported: RGBA only`
  const { data, width, height } = image as { data?: unknown; width: number; height: number }
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray))
    return 'texel storage is unsupported: 8-bit texels only'
  if (data.length !== rgbaBytes(width, height))
    return `texel storage holds ${data.length} bytes, not ${width}×${height} RGBA`
}

/** Why the texels a record holds in memory cannot be read as `textureRgba` reads them, in
 *  `texelsReason`'s words: its own format for raw texels (`layout` `'data'`), RGBA for any other
 *  picture. The texture fill throws it (#43). */
export const texelsRefusal = (texture: Texture) =>
  texelsReason({
    format: texture.layout === 'data' ? texture.format : 'rgba',
    image: texture.image,
  })

type TextureRgba = { data: Uint8Array; width: number; height: number }
/**
 * Bytes of a texture, kept as long as it shows the same image. The rasterizer and the sample
 * call this per texel read: without a cache, each texel allocated a `Uint8Array` view and an
 * object. The source is rechecked every call — buffer, offset, length, width, height — so a
 * replaced image does yield the new bytes.
 */
const rgbaCache = new WeakMap<Texture, { source: ArrayBufferView; rgba: TextureRgba }>()

export function textureRgba(texture: Texture): TextureRgba | null {
  const image = texture.image as
    { data?: ArrayBufferView; width?: number; height?: number } | undefined
  if (!image?.data || !image.width || !image.height) return null
  const src = image.data
  const held = rgbaCache.get(texture)
  if (
    held &&
    held.source === src &&
    held.rgba.width === image.width &&
    held.rgba.height === image.height &&
    held.rgba.data.buffer === src.buffer &&
    held.rgba.data.byteOffset === src.byteOffset &&
    held.rgba.data.byteLength === src.byteLength
  )
    return held.rgba
  const rgba: TextureRgba = {
    data: new Uint8Array(src.buffer, src.byteOffset, src.byteLength),
    width: image.width,
    height: image.height,
  }
  rgbaCache.set(texture, { source: src, rgba })
  return rgba
}
