import type { HostAttributes } from '../../host/resources.ts';
import type { Texture } from '../../../../sdk-core/src/index.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import { createPageRowConstants } from './pageRowConstants.ts';
import { slotSampled } from '../tile/samplingHeaders.ts';
import { materialClassKey } from '../../visibility/shader/materialClass.ts';
import { MODEL_SHIFT } from '../../scene/surfaceModel.ts';
import { FLAG_NORMAL, FLAG_UV } from '../../cluster/format.ts';
import {
  FLAG_CLUSTER_PAGE,
  FLAG_LIT,
  FLAG_DOUBLE,
  FLAG_HAS_UV,
  FLAG_HAS_MAP,
  FLAG_HAS_NORMAL,
  FLAG_HAS_TANGENT,
  FLAG_MASK,
  FLAG_BACK,
  FLAG_HAS_ORM,
  FLAG_HAS_NORMAL_MAP,
  FLAG_SAMPLED,
  type VisMaterial,
} from '../../visibility/buffer.ts';

export type GeometryBlock = {
  vertexBase: number;
  count: number;
  hasUv: boolean;
  hasNormal: boolean;
  hasTangent: boolean;
  /** The row reads its geometry from the quantized page in its pool slot, not from the source
   *  float buffers: `vertexBase` then addresses nothing. */
  quantized?: boolean;
};

/**
 * The geometry a row reads, into a block the caller owns — a row is rewritten at every arrival
 * and every slot move, and this runs there.
 *
 * A cluster the engine uploaded as a quantized page reads that page: the page's own flags say
 * which attributes it carries, and it stores no tangent — the resolve rebuilds the frame from
 * the triangle (`../../cluster/decodeWgsl.ts`). Any other cluster reads the source block its primitive
 * was packed into, as before.
 */
export function rowGeometry(
  rec: Pick<PageRec, 'attributes' | 'geometryPage'>,
  geometryBlocks: ReadonlyMap<HostAttributes, GeometryBlock>,
  into: GeometryBlock,
) {
  const page = rec.geometryPage;
  if (!page) return geometryBlocks.get(rec.attributes);
  into.vertexBase = 0;
  into.count = page.vertexCount;
  into.hasUv = (page.flags & FLAG_UV) !== 0;
  into.hasNormal = (page.flags & FLAG_NORMAL) !== 0;
  into.hasTangent = false;
  into.quantized = true;
  return into;
}

/** A block `rowGeometry` may fill; one per caller, never shared. */
export const emptyGeometryBlock = (): GeometryBlock => ({
  vertexBase: 0,
  count: 0,
  hasUv: false,
  hasNormal: false,
  hasTangent: false,
  quantized: false,
});
/** An atlas as a material reads it: its page table, whose headers say which slots take their
 *  filter rule (`slotSampled`). */
type SampledAtlas = { pages: { readonly words: Uint32Array } };
/** The two atlases a material's slots index. */
type SampledAtlases = { color: SampledAtlas; data: SampledAtlas };

/** Atlas slots of a scene's textures, by texture; a texture the atlas does not hold reads slot 0.
 *  `textures`, the atlases themselves, once they exist. */
export type MaterialLayers = {
  mapLayer: ReadonlyMap<Texture, number>;
  dataLayer: ReadonlyMap<Texture, number>;
  textures?: SampledAtlases;
};

/** A texture's slot in an atlas table; 0, the fill texel, for none or one the atlas lacks. */
export const layerSlot = (layers: ReadonlyMap<Texture, number>, texture?: Texture) =>
  texture ? (layers.get(texture) ?? 0) : 0;

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
) {
  if (!textures) return 0;
  const color = textures.color.pages,
    data = textures.data.pages;
  return slotSampled(color, color0) ||
    slotSampled(color, color1) ||
    slotSampled(data, data0) ||
    slotSampled(data, data1) ||
    slotSampled(data, data2) ||
    slotSampled(data, data3)
    ? FLAG_SAMPLED
    : 0;
}

/** What a page row says of its material: its map slots, its flags word, and its resolve class. */
export function rowMaterial(
  mat: VisMaterial,
  geo: GeometryBlock | undefined,
  { mapLayer, dataLayer, textures }: MaterialLayers,
) {
  const map = layerSlot(mapLayer, mat.map),
    rough = layerSlot(dataLayer, mat.roughnessMap),
    metal = layerSlot(dataLayer, mat.metalnessMap),
    normal = layerSlot(dataLayer, mat.normalMap),
    ao = layerSlot(dataLayer, mat.aoMap),
    emissive = layerSlot(mapLayer, mat.emissiveMap);
  let flags = 0;
  if (mat.lit) flags |= FLAG_LIT;
  if (mat.doubleSided) flags |= FLAG_DOUBLE;
  if (geo?.hasUv) flags |= FLAG_HAS_UV;
  if (map) flags |= FLAG_HAS_MAP;
  if (geo?.hasNormal) flags |= FLAG_HAS_NORMAL;
  if (geo?.hasTangent) flags |= FLAG_HAS_TANGENT;
  if (mat.alphaTest > 0) flags |= FLAG_MASK;
  if (mat.backSide) flags |= FLAG_BACK;
  if (rough || metal) flags |= FLAG_HAS_ORM;
  if (normal) flags |= FLAG_HAS_NORMAL_MAP;
  flags |= (mat.model ?? 0) << MODEL_SHIFT;
  flags |= sampledFlag(textures, map, emissive, rough, metal, normal, ao);
  const classKey = materialClassKey(flags, { rough, metal, ao, emissive, normal });
  // Where the row reads its geometry is not a material feature: it never splits a resolve class.
  if (geo?.quantized) flags |= FLAG_CLUSTER_PAGE;
  return { map, rough, metal, normal, ao, emissive, flags, classKey };
}

/**
 * Resolve classes of a scene, sorted: the class of every page that takes a row — transparent
 * pages never do (`sync.ts`) — from the same material fields, geometry block and atlas
 * slots the row will carry. Known once the atlases are laid out, before any image: the class
 * pipelines are compiled here, never on the frame that first draws one.
 */
export function sceneMaterialClasses(
  allPages: readonly PageRec[],
  geometryBlocks: ReadonlyMap<HostAttributes, GeometryBlock>,
  layers: MaterialLayers,
) {
  const constants = createPageRowConstants();
  const keys = new Set<number>();
  const block = emptyGeometryBlock();
  for (const rec of allPages)
    if (!rec.transparent)
      keys.add(
        rowMaterial(
          constants.materialOf(rec.material).mat,
          rowGeometry(rec, geometryBlocks, block),
          layers,
        ).classKey,
      );
  return [...keys].sort((a, b) => a - b);
}
