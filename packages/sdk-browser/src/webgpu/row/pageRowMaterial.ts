import type { HostAttributes } from '../../host/resources.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import type { PageRec } from '../../page/selection/types.ts'
import { slotSampled } from '../tile/samplingHeaders.ts'
import { FLAG_COLOR, FLAG_NORMAL, FLAG_UV, FLAG_UV1 } from '../../../../sdk-core/src/page/format.ts'
import { GEOMETRY_VOXEL } from '../../../../sdk-core/src/page/voxelPage.ts'
import { FLAG_SAMPLED } from '../../visibility/types.ts'

export type GeometryBlock = {
  vertexBase: number
  count: number
  hasUv: boolean
  hasNormal: boolean
  hasTangent: boolean
  /** Vertex colours: the page's `COLOR_0`, or the tail of the source UV buffer
   *  (`../core/vertexColors.ts`). */
  hasColor: boolean
  /** A second UV set: the page's `TEXCOORD_1`, or the tail of the normal atlas the float block is
   *  read through (`../core/geometryPoolLayout.ts`), which the physical maps on that set read. */
  hasUv1?: boolean
  /** The row reads its geometry from the quantized page in its pool slot, not from the source
   *  float buffers: `vertexBase` then addresses nothing. */
  quantized?: boolean
  /** A world's dynamic geometry, rewritten in place: its rows carry `FLAG_DYNAMIC`. */
  dynamic?: boolean
  /** A voxel brick (`GEOMETRY_VOXEL`): its rows carry `FLAG_VOXEL` and wear its voxels' surface. */
  voxel?: boolean
}

/**
 * The geometry a row reads, into a block the caller owns — a row is rewritten at every arrival
 * and every slot move, and this runs there.
 *
 * A cluster the engine uploaded as a quantized page reads that page: the page's own flags say
 * which attributes it carries, and it stores no tangent — the resolve rebuilds the frame from
 * the triangle (`../../cluster/decodeWgsl.ts`). Any other cluster reads the source block its primitive
 * was packed into.
 */
export function rowGeometry(
  rec: Pick<PageRec, 'attributes' | 'geometryPage'>,
  geometryBlocks: ReadonlyMap<HostAttributes, GeometryBlock>,
  into: GeometryBlock,
) {
  const page = rec.geometryPage
  if (!page) return geometryBlocks.get(rec.attributes)
  into.vertexBase = 0
  into.count = page.vertexCount
  // A voxel brick is no `WGP3` page: its corners carry a normal, nothing else.
  into.voxel = (page.flags & GEOMETRY_VOXEL) !== 0
  if (into.voxel) {
    Object.assign(into, { hasUv: false, hasNormal: true, hasTangent: false, hasColor: false })
    into.hasUv1 = false
    into.quantized = false
    return into
  }
  into.hasUv = (page.flags & FLAG_UV) !== 0
  into.hasNormal = (page.flags & FLAG_NORMAL) !== 0
  into.hasTangent = false
  into.hasColor = (page.flags & FLAG_COLOR) !== 0
  into.hasUv1 = (page.flags & FLAG_UV1) !== 0
  into.quantized = true
  return into
}

/** A block `rowGeometry` may fill; one per caller, never shared. */
export const emptyGeometryBlock = (): GeometryBlock => ({
  vertexBase: 0,
  count: 0,
  hasUv: false,
  hasNormal: false,
  hasTangent: false,
  hasColor: false,
  hasUv1: false,
  quantized: false,
  voxel: false,
})
/** An atlas as a material reads it: its page table, whose headers say which slots take their
 *  filter rule (`slotSampled`). */
type SampledAtlas = { pages: { readonly words: Uint32Array } }
/** The two atlases a material's slots index. */
type SampledAtlases = { color: SampledAtlas; data: SampledAtlas }

/** Atlas slots of a scene's textures, by texture; a texture the atlas does not hold reads slot 0.
 *  `textures`, the atlases themselves, once they exist. */
export type MaterialLayers = {
  mapLayer: ReadonlyMap<Texture, number>
  dataLayer: ReadonlyMap<Texture, number>
  textures?: SampledAtlases
}

/** A texture's slot in an atlas table; 0, the fill texel, for none or one the atlas lacks. */
export const layerSlot = (layers: ReadonlyMap<Texture, number>, texture?: Texture) =>
  texture ? (layers.get(texture) ?? 0) : 0

/** `FLAG_SAMPLED` when one of a material's maps, by its atlas slots, takes its filter rule: the
 *  flag that compiles or skips the filtered read, per page and per transparent item. */
export function sampledFlag(
  textures: SampledAtlases | undefined,
  color0: number,
  color1: number,
  data0: number,
  data1: number,
  data2: number,
  data3: number,
  color2 = 0,
) {
  if (!textures) return 0
  const color = textures.color.pages,
    data = textures.data.pages
  return slotSampled(color, color0) ||
    slotSampled(color, color1) ||
    slotSampled(color, color2) ||
    slotSampled(data, data0) ||
    slotSampled(data, data1) ||
    slotSampled(data, data2) ||
    slotSampled(data, data3)
    ? FLAG_SAMPLED
    : 0
}
