import type { PageSurface } from '../geometry/pages/surface.ts'
import type { Texture } from '../../../sdk-core/src/texture/contract.ts'
import { VIS_MAX_PAGE_TRIANGLES, VIS_PAGE_ROWS } from './visWords.ts'
import { PAGE_INFO } from './pageInfo.ts'
import { rgbaBytes } from '../materials/texture/imageExtent.ts'
import { wgslFn } from '../../../math/src/wgsl/decl.ts'
import type { ResponsiveLevel } from '../../../sdk-core/src/contracts/materialAbi.ts'
import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts'
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
 *  it reads (`vertUv1`, `../geometry/pages/pool/geometryPoolLayout.ts`); a float geometry carries
 *  no more than two sets. A quantized page says so in its own header. Below it, the rank of its
 *  surface's record (`../materials/table/materialTable.ts`). */
export const MATERIAL_SECOND_UV = 0x80000000,
  MATERIAL_RANK_MASK = 0x7fffffff
/** The bits of a row's offset word (`PageInfo.wpo`): the row's vertices are moved by its surface's
 *  `worldPositionOffset`, the temporal pass reprojects them by where they were, and the distance
 *  past which its object's offset stops does not stop it (its surface always evaluates). */
export const WPO_ROW_MOVES = 1,
  WPO_ROW_VELOCITY = 2,
  WPO_ROW_ALWAYS = 4
/** The address bits of `PageInfo.deformOutput`: the results' first word in the float pool plus
 *  one, wherever their source lies (`../deformation/outputs.ts`). */
export const DEFORM_ADDRESS = 0x3fffffff
/** The bit of `PageInfo.deformOutput` above its address: the results are a bank track's, shared by
 *  every row of the placements playing it, the first row to reach a vertex in an image deforming
 *  it for all (`../deformation/computeWgsl.ts`). Every reader of the address masks it away. */
export const DEFORM_SHARED = 0x40000000
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
  /** The row's surface is displaced and its height map is in the atlas
   *  (`SurfaceDisplacement`): the tessellation draws its triangles diced and pushed along their
   *  normals, where `tessellation` is on, and every raster leaves them to it
   *  (`./tessellation/`). The high bit: a word's other 31 are taken. */
  FLAG_DISPLACED = 0x80000000,
  /** Frame flag of the transparent draw: a diagnostic view is shown, the surface's own lighting is
   *  not (`../blend/uniforms.ts`, `diagnosticBits`). */
  FLAG_DIAGNOSTIC_VIEW = 0x40000000,
  /** A row's mesh has a distance field (`PageRec.distanceField`): the shade pass marks its pixels in the surface
   *  buffer's flags (`DISTANCE_FIELD_REPRESENTATION_FLAG`), which the screen probes' trace reads. The bit of
   *  `FLAG_DIAGNOSTIC_VIEW`, which is a frame flag of the blend pass: a blend item keeps only the low sixteen
   *  bits of a row's (`ITEM_FLAG_BITS`), so the two never meet. */
  FLAG_DISTANCE_FIELD = 0x40000000
/** Beside it, which view: its code (`DIAGNOSTIC_VIEWS`, `shader/shadeMode.ts`) in the four bits of the
 *  transparent pass's uniform flags (`uni.viewFlags`) from here, which the pass reads as the resolve reads
 *  `uni.mode`. Those bits (25-28) are the pixel model's in a blend item's own flags
 *  (`PIXEL_MODEL_SHIFT`), so the code never travels there: the vertex stage leaves it out of the item's
 *  flags it hands on. */
export const DIAGNOSTIC_CODE_SHIFT = 25,
  DIAGNOSTIC_CODE_MASK = 15
/** Fog opt-out above the model bits; a dynamic geometry's row, reactive to the temporal pass (#573);
 *  a row whose surface draws a sprite, or a line of a width other than zero: what every raster
 *  reads its surface's record for (`pageShape`), a row of neither reading none. */
export const FLAG_FOG_FREE = 1 << 20,
  FLAG_DYNAMIC = 1 << 21,
  FLAG_SPRITE = 1 << 22,
  /** The row's surface wires a `pixelDepthOffset` (`../materials/graph/pdoProgram.ts`): the visibility
   *  rasters evaluate it at each pixel the row covers and write that depth in place of the plane's.
   *  A row that has it is a cutout row too (`FLAG_MASK`), which reads its coordinate for it; the
   *  opaque passes alone read this bit, a blend item's flags never reach it
   *  (`ITEM_FLAG_BITS`). */
  FLAG_DEPTH_OFFSET = 1 << 27,
  FLAG_LINE = 1 << 23,
  /** A row of a held-out placement (`PLACEMENT_HOLDOUT`): where the alpha holdout is in effect the resolve draws its
   *  pixels black, lit by nothing, and marks them in the surface flags (`HOLDOUT_SURFACE_FLAG`). A row's bit alone: a
   *  blend item keeps only the low sixteen (`ITEM_HOLDOUT`). */
  FLAG_HOLDOUT = 1 << 28,
  /** The texture set a row's base map reads (glTF's `texCoord`, `Texture.channel`, 0 to 7), in
   *  three flags: its low bit here, its middle bit at `FLAG_MAP_UV_HIGH`, its top bit at
   *  `FLAG_MAP_UV_TOP`: what every vertex stage hands its cutout and transmittance (`pageMaskUv`,
   *  `shader/pageUvSetWgsl.ts`). Row flags alone: a blend item reads its record's `channels`. */
  FLAG_MAP_UV_LOW = 1 << 24,
  FLAG_MAP_UV_HIGH = 1 << 29,
  FLAG_MAP_UV_TOP = 1 << 16
/** The two bits from here of a row's flags: the temporal responsiveness of its surface
 *  (`VisMaterial`'s `responsive`), as its code (`responsiveCode`). The opaque passes carry it as
 *  they carry a pixel animation, the velocity stage writing it into the flags of its pixels
 *  (`../post/taa/surfaceVelocityWgsl.ts`); a blend item carries it in its record's own bits
 *  (`ITEM_RESPONSIVE_SHIFT`), its layers writing it into a target of their own
 *  (`RESPONSIVE_TARGET`). The blend pass's frame flags hold their diagnostic code at these bits, a
 *  word a row's flags reach through `ITEM_FLAG_BITS` alone, its low sixteen bits. Bit 16 is the
 *  base map's top texture-set bit, bits 17 to 19 the surface model's (`MODEL_SHIFT`), 20 to 24 the
 *  flags above, 29 the base map's middle texture-set bit. */
export const RESPONSIVE_SHIFT = 25,
  RESPONSIVE_MASK = 3
/** The bits of a responsiveness code: the pixel is read as a pixel animation (its motion vector is
 *  no guide to its detail), and its history restarts. */
export const RESPONSIVE_ANIMATED = 1,
  RESPONSIVE_RESTARTS = 2
/** The code of each level (`RESPONSIVE_LEVELS`): `off` none, `medium` a pixel animation, `full` a
 *  pixel animation whose history restarts. */
const RESPONSIVE_CODES: Readonly<Record<ResponsiveLevel, number>> = {
  off: 0,
  medium: RESPONSIVE_ANIMATED,
  full: RESPONSIVE_ANIMATED | RESPONSIVE_RESTARTS,
}
/** The responsiveness code of `level` (`RESPONSIVE_SHIFT`); none, `off`. */
export const responsiveCode = (level: ResponsiveLevel = 'off') => RESPONSIVE_CODES[level]
/** What a layer of responsiveness code `code` writes into the responsive target
 *  (`RESPONSIVE_TARGET`) where it covers a pixel: the code in thirds, so the 8-bit unorm channel
 *  holds the three codes exactly and the largest of the layers' keeps every bit any of them has
 *  (the codes' union is their largest). */
export const RESPONSIVE_MARK_WGSL = wgslFn(
  'responsiveMark',
  [],
  `fn responsiveMark(code:u32)->f32{return f32(code&${RESPONSIVE_MASK}u)/${RESPONSIVE_MASK}.0;}`,
)
/** The code a pixel's mark holds (`RESPONSIVE_MARK_WGSL` undone). */
export const MARKED_RESPONSIVE_WGSL = wgslFn(
  'markedResponsive',
  [],
  `fn markedResponsive(mark:f32)->u32{return u32(round(mark*${RESPONSIVE_MASK}.0));}`,
)
export type VisPage = {
  array: Uint32Array
  attributes: Geometry['attributes']
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
