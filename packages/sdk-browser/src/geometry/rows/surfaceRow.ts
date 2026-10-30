import { materialClassKey } from '../../visibility/shader/materialClass.ts'
import { MAX_UV_SETS } from '../../../../sdk-core/src/page/format.ts'
import {
  PHYSICAL_MAP_FIELDS,
  SURFACE_MAP_FIELDS,
  type VisMaterial,
} from '../../visibility/materialType.ts'
import { channelsOf } from '../../materials/table/materialRecord.ts'
import { hasPhysicalLobes } from '../../materials/surface/physicalLobes.ts'
import { graphClassKey } from '../../materials/graph/surfaceClasses.ts'
import { altSetOf } from '../../materials/graph/state.ts'
import { maskOf } from '../../materials/graph/maskProgram.ts'
import { depthOffsetOf } from '../../materials/graph/pdoProgram.ts'
import { displacementOf } from '../../materials/graph/displacementProgram.ts'
import { wpoOf } from '../../materials/graph/wpoProgram.ts'
import { isProgram, programOf, type SurfaceProgram } from '../../materials/graph/surfaceProgram.ts'
import { MODEL_SHIFT } from '../../materials/surface/surfaceModelWord.ts'
import { shadingModelCode } from '../../materials/surface/shadingModelCode.ts'
import {
  layerSlot,
  physicalMapSlot,
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
  FLAG_DEPTH_OFFSET,
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
  FLAG_MAP_UV_TOP,
  FLAG_VOXEL,
  RESPONSIVE_SHIFT,
  WPO_ROW_ALWAYS,
  WPO_ROW_MOVES,
  responsiveCode,
} from '../../visibility/types.ts'

/**
 * What a surface brings to each of its rows whatever their geometry: its maps' slots in the two
 * atlases, its anisotropy, coat and cloth maps' (`PHYSICAL_MAP_FIELDS` order, zeros without a lobe), and
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
  lobeMaps: [number, number, number, number, number, number, number]
  /** The surface carries an anisotropic or clear-coat lobe (`hasPhysicalLobes`). */
  physical: boolean
  /** A map of the surface reads a UV set past the first (`channelsOf`, glTF's `texCoord`). */
  readsExtraUv: boolean
  vertexColors: boolean
  /** The code of the shading model the record names (`shadingModelCode`), 0 for none. */
  shadingCode: number
  /** The program of the graph the surface wears, where it compiles: the surface then reads none of
   *  the maps above, which are zero, nor the lobes' factors, nor its geometry's colours
   *  (`wearGraph`). */
  graph: SurfaceProgram | undefined
  /** `WPO_ROW_MOVES` where the surface's graph can move its rows' vertices (`PageInfo.wpo`): it wires a
   *  `worldPositionOffset` the rasters evaluate, and the surface is neither a sprite nor a line;
   *  with `WPO_ROW_ALWAYS` where it evaluates whatever its object and the distance say. Whether the
   *  object evaluates it, and the rest of the row's offset words, are the object's
   *  (`../rows/page/offsetRow.ts`). */
  wpo: number
  /** The most its offset may move a vertex along an axis, in metres (`maxWorldPositionOffset`, 0
   *  for no limit): the row takes the greatest of the object's surfaces. */
  wpoMost: number
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
  lobeMaps: [0, 0, 0, 0, 0, 0, 0],
  physical: false,
  readsExtraUv: false,
  vertexColors: false,
  shadingCode: 0,
  graph: undefined,
  wpo: 0,
  wpoMost: 0,
  bits: 0,
})

/** The row of a surface that wears the graph `row.graph`: the graph computes what its maps and its
 *  geometry's colours gave, and the lobes' factors, so none is read — the lobes themselves it may
 *  wire (`hasPhysicalLobes`) —; it reads the texture sets it names. */
function wearGraph(row: SurfaceRow) {
  const { sets } = row.graph!.compiled.uses
  Object.assign(row, {
    ...{ map: 0, rough: 0, metal: 0, normal: 0, ao: 0, emissive: 0, subsurface: 0 },
    ...{ readsExtraUv: altSetOf(sets) !== 0, vertexColors: false },
  })
  row.lobeMaps.fill(0)
}

/** The maps `mat` wears, their slots, its lobes' and its graph, into `into`. */
function readMaps(mat: VisMaterial, layers: MaterialLayers, into: SurfaceRow) {
  const { mapLayer, dataLayer } = layers
  into.map = layerSlot(mapLayer, mat.map)
  into.rough = layerSlot(dataLayer, mat.roughnessMap)
  into.metal = layerSlot(dataLayer, mat.metalnessMap)
  into.normal = layerSlot(dataLayer, mat.normalMap)
  into.ao = layerSlot(dataLayer, mat.aoMap)
  into.emissive = layerSlot(mapLayer, mat.emissiveMap)
  into.subsurface = layerSlot(mapLayer, mat.subsurfaceMap)
  into.physical = hasPhysicalLobes(mat)
  for (let i = 0; i < PHYSICAL_MAP_FIELDS.length; i++)
    into.lobeMaps[i] = into.physical ? physicalMapSlot(layers, mat, PHYSICAL_MAP_FIELDS[i]) : 0
  into.readsExtraUv = channelsOf(mat, SURFACE_MAP_FIELDS) !== 0
  into.vertexColors = !!mat.vertexColors
  into.shadingCode = shadingModelCode(mat.shadingModel)
  const program = programOf(mat)
  into.graph = isProgram(program) ? program : undefined
  if (into.graph) wearGraph(into)
}

/** The flags the material and its maps set on its surface. */
function materialBits(mat: VisMaterial, into: SurfaceRow) {
  let bits = 0
  if (mat.lit) bits |= FLAG_LIT
  // A sky surface is drawn ahead of the fog (`encodeSkyPass.ts`), which is laid over the image whole afterwards: it takes none of its own.
  if (mat.fog === false || mat.sky === true) bits |= FLAG_FOG_FREE
  bits |= responsiveCode(mat.responsive) << RESPONSIVE_SHIFT
  if (mat.side === 'double') bits |= FLAG_DOUBLE
  if (into.map) bits |= FLAG_HAS_MAP
  if (mat.side === 'back') bits |= FLAG_BACK
  if (into.rough || into.metal) bits |= FLAG_HAS_ORM
  if (into.normal) bits |= FLAG_HAS_NORMAL_MAP
  // What every raster reads its record for (`pageShape`): a sprite, a line of a width.
  if (mat.sprite) bits |= FLAG_SPRITE
  if ((mat.lineWidth ?? 0) !== 0) bits |= FLAG_LINE
  return bits
}

/** The texture set a raster reads, the cutout's, the depth offset's or the vertex offset's,
 *  whichever names one. */
function rasterSetOf(
  mat: VisMaterial,
  mask: ReturnType<typeof maskOf> | undefined,
  depth: ReturnType<typeof depthOffsetOf> | undefined,
  offset: ReturnType<typeof wpoOf> | undefined,
) {
  const named = [mask, depth, offset].find((program) => program?.uses.sets)
  const rasterSet = named?.set
  return rasterSet ?? (mask || depth ? 0 : Math.min(mat.map?.channel ?? 0, MAX_UV_SETS - 1))
}

/** The flags the cutout, the depth offset, the map's texture set and the displacement set. */
function rasterBits(mat: VisMaterial, dataLayer: MaterialLayers['dataLayer'], into: SurfaceRow) {
  let bits = 0
  // A dashed line cuts its gaps where a masked surface cuts its cutout (`maskKeep`); a graph that
  // wires an `opacityMask` is a masked surface, its cutout read at the one texture set the mask
  // names (`maskProgram.ts`).
  const mask = into.graph && maskOf(into.graph)
  // A graph that wires a `pixelDepthOffset` has the rasters read its coordinate where they read a
  // cutout's, and write the depth it gives (`pdoProgram.ts`); the row asks both.
  const depth = into.graph && depthOffsetOf(into.graph)
  if (mat.alphaTest > 0 || mat.dashSize !== undefined || mask || depth) bits |= FLAG_MASK
  if (depth) bits |= FLAG_DEPTH_OFFSET
  const baseSet = rasterSetOf(mat, mask, depth, into.graph && wpoOf(into.graph))
  if (baseSet & 1) bits |= FLAG_MAP_UV_LOW
  if (baseSet & 2) bits |= FLAG_MAP_UV_HIGH
  if (baseSet & 4) bits |= FLAG_MAP_UV_TOP
  // The tessellation draws a displaced surface whose height map the atlas holds
  // (`../../visibility/tessellation/`).
  if (
    mat.displacement &&
    (layerSlot(dataLayer, mat.displacementMap) || (into.graph && displacementOf(into.graph)))
  )
    bits |= FLAG_DISPLACED
  return bits
}

/** The flags word of `mat`'s surface, the vertex offset's rows set on `into` on the way. */
function surfaceBits(mat: VisMaterial, dataLayer: MaterialLayers['dataLayer'], into: SurfaceRow) {
  const bits = materialBits(mat, into) | rasterBits(mat, dataLayer, into)
  const offset = into.graph && wpoOf(into.graph)
  // The offset moves the vertices of a triangle surface, a displaced one's included (the dicing takes
  // the moved triangle); a sprite or a line is built on screen.
  into.wpo =
    offset && !(bits & (FLAG_SPRITE | FLAG_LINE))
      ? WPO_ROW_MOVES | (mat.alwaysEvaluateWorldPositionOffset === true ? WPO_ROW_ALWAYS : 0)
      : 0
  into.wpoMost = into.wpo ? Math.max(mat.maxWorldPositionOffset ?? 0, 0) : 0
  return bits | ((mat.model ?? 0) << MODEL_SHIFT)
}

/** What `mat` brings to its rows (`SurfaceRow`), into `into`. */
export function surfaceRow(mat: VisMaterial, layers: MaterialLayers, into = emptySurfaceRow()) {
  readMaps(mat, layers, into)
  into.bits = surfaceBits(mat, layers.dataLayer, into)
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
  if (geo?.voxel) return voxelRowFlags(s)
  let flags = s.bits
  if (geo?.hasUv) flags |= FLAG_HAS_UV
  if (geo?.hasNormal) flags |= FLAG_HAS_NORMAL
  if (geo?.hasTangent) flags |= FLAG_HAS_TANGENT
  // The material asks for its vertex colours, or its graph reads them (`vertexColor`), and the
  // geometry has some: the forward rule, the graph's the colour alone, which it multiplies by nothing.
  if ((s.vertexColors || s.graph?.compiled.uses.colour) && geo?.hasColor) flags |= FLAG_HAS_COLOR
  flags |= sampledFlag(textures, s.map, s.emissive, s.rough, s.metal, s.normal, s.ao, s.subsurface)
  // The anisotropy, coat, cloth and specular maps read through the data atlas as the others do, the fuzz
  // colour map through the colour atlas (`physicalWgsl.ts`).
  const lobe = s.lobeMaps
  if (s.physical)
    flags |= sampledFlag(
      textures,
      0,
      lobe[5],
      lobe[0],
      lobe[1],
      lobe[2],
      lobe[3],
      0,
      lobe[4],
      lobe[6],
    )
  const features = materialClassKey(flags, s, s.readsExtraUv && !!geo?.hasExtraUv)
  // A graph's program is its own class, over the features its rows are worn on.
  const classKey = (s.graph?.kind === 'resolve' && graphClassKey(s.graph, features)) || features
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

/** The flags and class of a voxel brick's row (`FLAG_VOXEL`): its surface's lighting and model,
 *  none of its maps — its voxels carry their own prefiltered colour, roughness and occlusion —,
 *  its side the back one — a voxel brick's boxes are drawn by their back faces alone, each pixel
 *  traced once, from the eye or the box's entry, whichever is farther, so an eye inside a box or a
 *  box across the near plane still draws its voxels —, its normals its voxels'. */
function voxelRowFlags(s: SurfaceRow) {
  const flags = (s.bits & VOXEL_KEPT) | FLAG_VOXEL | FLAG_HAS_NORMAL | FLAG_BACK
  return { flags, classKey: materialClassKey(flags, { ...NO_MAPS, shadingCode: s.shadingCode }) }
}
