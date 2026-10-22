import { materialClassKey } from '../../visibility/shader/materialClass.ts'
import { GEOMETRY_VOXEL } from '../../../../sdk-core/src/page/voxelPage.ts'
import { MAX_UV_SETS } from '../../../../sdk-core/src/page/format.ts'
import type { PageRec } from '../selection/types.ts'
import {
  PHYSICAL_MAP_FIELDS,
  SURFACE_MAP_FIELDS,
  type VisMaterial,
} from '../../visibility/materialType.ts'
import { channelsOf } from '../../materials/table/materialRecord.ts'
import { hasPhysicalLobes } from '../../materials/surface/physicalLobes.ts'
import { MODEL_SHIFT } from '../../materials/surface/surfaceModel.ts'
import {
  layerSlot,
  sampledFlag,
  type GeometryBlock,
  type MaterialLayers,
} from './page/pageRowMaterial.ts'
import {
  FLAG_CLUSTER_PAGE,
  FLAG_LIT,
  FLAG_DOUBLE,
  FLAG_HAS_UV,
  FLAG_HAS_MAP,
  FLAG_HAS_NORMAL,
  FLAG_HAS_TANGENT,
  FLAG_HAS_COLOR,
  FLAG_MASK,
  FLAG_BACK,
  FLAG_HAS_ORM,
  FLAG_HAS_NORMAL_MAP,
  FLAG_FOG_FREE,
  FLAG_DISPLACED,
  FLAG_DYNAMIC,
  FLAG_SPRITE,
  FLAG_LINE,
  FLAG_MAP_UV_HIGH,
  FLAG_MAP_UV_LOW,
  FLAG_VOXEL,
  HISTORY_SHARE_SHIFT,
  historyShareCode,
} from '../../visibility/types.ts'

/**
 * What a surface brings to each of its rows whatever their geometry: its maps' slots in the two
 * atlases, its anisotropy and coat maps' (`PHYSICAL_MAP_FIELDS` order, zeros without a lobe), and
 * its own flag bits. It depends on the surface's version and the atlases' slots alone: the material
 * table keeps one per surface (`SurfaceSeen.row`, `../../materials/table/materialTable.ts`), written again
 * when either moved, so a row write reads no map of slots (`rowFlags`).
 */
export type SurfaceRow = {
  map: number
  rough: number
  metal: number
  normal: number
  ao: number
  emissive: number
  subsurface: number
  lobeMaps: [number, number, number, number]
  /** The surface carries an anisotropic or clear-coat lobe (`hasPhysicalLobes`). */
  physical: boolean
  /** A map of the surface reads a UV set past the first (`channelsOf`, glTF's `texCoord`). */
  readsExtraUv: boolean
  vertexColors: boolean
  bits: number
}

/** A summary to fill (`surfaceRow`). */
export const emptySurfaceRow = (): SurfaceRow => ({
  map: 0,
  rough: 0,
  metal: 0,
  normal: 0,
  ao: 0,
  emissive: 0,
  subsurface: 0,
  lobeMaps: [0, 0, 0, 0],
  physical: false,
  readsExtraUv: false,
  vertexColors: false,
  bits: 0,
})

/** What `mat` brings to its rows (`SurfaceRow`), into `into`. */
export function surfaceRow(
  mat: VisMaterial,
  { mapLayer, dataLayer }: MaterialLayers,
  into = emptySurfaceRow(),
) {
  into.map = layerSlot(mapLayer, mat.map)
  into.rough = layerSlot(dataLayer, mat.roughnessMap)
  into.metal = layerSlot(dataLayer, mat.metalnessMap)
  into.normal = layerSlot(dataLayer, mat.normalMap)
  into.ao = layerSlot(dataLayer, mat.aoMap)
  into.emissive = layerSlot(mapLayer, mat.emissiveMap)
  into.subsurface = layerSlot(mapLayer, mat.subsurfaceMap)
  into.physical = hasPhysicalLobes(mat)
  for (let i = 0; i < 4; i++)
    into.lobeMaps[i] = into.physical ? layerSlot(dataLayer, mat[PHYSICAL_MAP_FIELDS[i]]) : 0
  into.readsExtraUv = channelsOf(mat, SURFACE_MAP_FIELDS) !== 0
  into.vertexColors = !!mat.vertexColors
  let bits = 0
  if (mat.lit) bits |= FLAG_LIT
  if (mat.fog === false) bits |= FLAG_FOG_FREE
  bits |= historyShareCode(mat.historyShare) << HISTORY_SHARE_SHIFT
  if (mat.side === 'double') bits |= FLAG_DOUBLE
  if (into.map) bits |= FLAG_HAS_MAP
  // A dashed line cuts its gaps where a masked surface cuts its cutout (`maskKeep`).
  if (mat.alphaTest > 0 || mat.dashSize !== undefined) bits |= FLAG_MASK
  const baseSet = Math.min(mat.map?.channel ?? 0, MAX_UV_SETS - 1)
  if (baseSet & 1) bits |= FLAG_MAP_UV_LOW
  if (baseSet & 2) bits |= FLAG_MAP_UV_HIGH
  if (mat.side === 'back') bits |= FLAG_BACK
  if (into.rough || into.metal) bits |= FLAG_HAS_ORM
  if (into.normal) bits |= FLAG_HAS_NORMAL_MAP
  // The tessellation draws a displaced surface whose height map the atlas holds
  // (`../../visibility/tessellation/`).
  if (mat.displacement && layerSlot(dataLayer, mat.displacementMap)) bits |= FLAG_DISPLACED
  // What every raster reads its record for (`pageShape`): a sprite, a line of a width.
  if (mat.sprite) bits |= FLAG_SPRITE
  if ((mat.lineWidth ?? 0) !== 0) bits |= FLAG_LINE
  into.bits = bits | ((mat.model ?? 0) << MODEL_SHIFT)
  return into
}

/**
 * What a page row says of its material: its flags word — its surface's bits, its geometry's, and
 * `FLAG_SAMPLED` where one of its maps, by its atlas slot, takes its filter rule, read off the
 * atlases' headers now —, and its resolve class.
 */
export function rowFlags(
  s: SurfaceRow,
  geo: GeometryBlock | undefined,
  textures: MaterialLayers['textures'],
) {
  if (geo?.voxel) return voxelRowFlags(s.bits)
  let flags = s.bits
  if (geo?.hasUv) flags |= FLAG_HAS_UV
  if (geo?.hasNormal) flags |= FLAG_HAS_NORMAL
  if (geo?.hasTangent) flags |= FLAG_HAS_TANGENT
  // The material asks for its vertex colours, and the geometry has some: the forward rule.
  if (s.vertexColors && geo?.hasColor) flags |= FLAG_HAS_COLOR
  flags |= sampledFlag(textures, s.map, s.emissive, s.rough, s.metal, s.normal, s.ao, s.subsurface)
  // The anisotropy and coat maps read through the data atlas as the others do (`physicalWgsl.ts`).
  const lobe = s.lobeMaps
  if (s.physical) flags |= sampledFlag(textures, 0, 0, lobe[0], lobe[1], lobe[2], lobe[3])
  const classKey = materialClassKey(flags, s, s.readsExtraUv && !!geo?.hasExtraUv)
  // Where the row reads its geometry is not a material feature: it never splits a resolve class.
  if (geo?.quantized) flags |= FLAG_CLUSTER_PAGE
  if (geo?.dynamic) flags |= FLAG_DYNAMIC
  return { flags, classKey }
}

/** The bits a voxel row keeps of its surface's (`surfaceBits`): lit, fogged, its model. */
const VOXEL_KEPT = ~(
  FLAG_HAS_MAP |
  FLAG_MASK |
  FLAG_BACK |
  FLAG_DOUBLE |
  FLAG_HAS_ORM |
  FLAG_HAS_NORMAL_MAP |
  FLAG_SPRITE |
  FLAG_LINE
)
/** A row of no map: what a voxel row resolves with, whatever its surface's. */
const NO_MAPS = { rough: 0, metal: 0, ao: 0, emissive: 0, normal: 0 }

/**
 * The side a row draws (`visBin`, the shadow casters' `FLAG_BACK`): its surface's, but a voxel
 * row's boxes are drawn by their back faces alone — each pixel traced once, from the eye or the
 * box's entry, whichever is farther, so an eye inside a box or a box across the near plane still
 * draws its voxels. The rule, written once here, gives the row its flags too (`voxelRowFlags`).
 */
export const rowSide = (rec: PageRec): PageRec['material']['side'] =>
  (rec.geometryPage?.flags ?? 0) & GEOMETRY_VOXEL ? 'back' : rec.material.side

/** The flags and class of a voxel brick's row (`FLAG_VOXEL`): its surface's lighting and model,
 *  none of its maps — its voxels carry their own prefiltered colour, roughness and occlusion —,
 *  its side `rowSide`'s, its normals its voxels'. */
function voxelRowFlags(bits: number) {
  const flags = (bits & VOXEL_KEPT) | FLAG_VOXEL | FLAG_HAS_NORMAL | FLAG_BACK
  return { flags, classKey: materialClassKey(flags, NO_MAPS) }
}
