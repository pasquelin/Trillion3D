import { PAGE_DEFORM_WORD, PAGE_PHYSICAL_WORD } from '../../visibility/types.ts'
import { physicalWord, type PhysicalTable } from '../visibility/physicalTable.ts'
import type { HostAttributes } from '../../host/resources.ts'
import { rootOf, type PageRec } from '../../page/selection/selection.ts'
import type { Placements } from '../../page/selection/placements.ts'
import { depthLayerUnits } from '../../../../sdk-core/src/index.ts'
import { createPageRowConstants } from './pageRowConstants.ts'
import {
  emptyGeometryBlock,
  rowGeometry,
  rowMaterial,
  type GeometryBlock,
  type MaterialLayers,
} from './pageRowMaterial.ts'
import {
  assertVisibilityPageTriangles,
  FLAG_BLEND_CASTER,
  frameNormalScaleY,
  PAGE_INFO_STRIDE,
} from '../../visibility/buffer.ts'
import { surfaceOpacity, type PageSurface } from '../../page/surface.ts'
import { shownAsIs } from '../../scene/surfaceModel.ts'
import { neverCulled, writeSpriteWords } from '../../visibility/shader/spriteWgsl.ts'
import type { SessionDeformation } from '../../deformation/session.ts'
import { writeRowDeformation } from '../../deformation/slotLayout.ts'
import { ROW_PLACEMENT_WORD } from './rowPlacement.ts'
import { NO_HIZ_SLOT } from './noHizSlot.ts'
import { surfaceEmitsOrOccludes } from '../../scene/surfaceEmission.ts'
import {
  packedRowBase,
  rowIndexCount,
  ROW_BLEND_COVERAGE_WORD,
  ROW_DASH_WORD,
  ROW_FLAGS_WORD,
  ROW_HIZ_SLOT_WORD,
  ROW_ID_BASE_WORD,
  ROW_INDEX_WORDS,
  ROW_LINE_WIDTH_WORD,
  ROW_MAP_LAYER_WORD,
  ROW_MATERIAL_CLASS_WORD,
  ROW_SPRITE_WORD,
  ROW_TRANSMISSION_WORD,
  ROW_VERTEX_BASE_WORD,
} from './pageRow.ts'

type PageRowResources = MaterialLayers & {
  geometryBlocks: Map<HostAttributes, GeometryBlock>
  /** Set once an opaque row shows a surface as-is (`shownAsIs`): from then on the image has flags
   *  temporal antialiasing and the composition must read (OMB-11). Never unset: a row it no longer
   *  draws only keeps the reading variant, which is right for every image. */
  asIsShown: boolean
  /** Set once an opaque row's surface can emit or occlude (`surfaceEmitsOrOccludes`): the image's
   *  resolve then writes the emission-and-occlusion layer (`emissiveAoLayer.ts`). Never unset. */
  emissiveAoShown: boolean
  /** The session's GPU deformation, once prepared: the record each placement's rows name. */
  deformation?: Pick<SessionDeformation, 'rowWord'>
  /** The surfaces' anisotropic and clear-coat records (`../visibility/physicalTable.ts`). */
  physicalTable?: Pick<PhysicalTable, 'rowWord'>
}
/** What every row write shares, made once with the writer. */
type RowWriter = {
  resources: PageRowResources
  markRowDirty: (row: number) => void
  roots: Placements
  rootRank: (packed: number) => number
  // What the catalogue fixes once and for all is not recomputed for every arriving page.
  constants: ReturnType<typeof createPageRowConstants>
  // Filled again at every row write, never allocated again.
  block: GeometryBlock
}

/** Serializes one drawable cluster row after its occupant, slot, or input epoch changes. */
export function createPageRowWriter(
  resources: PageRowResources,
  markRowDirty: (row: number) => void,
  /** The placement roots, and the root rank of each packed rank (#1235): the row's world, its
   *  placement word and its deformation record are its instance's root's. */
  roots: Placements,
  rootRank: (packed: number) => number,
) {
  const w: RowWriter = {
    ...{ resources, markRowDirty, roots, rootRank },
    constants: createPageRowConstants(),
    block: emptyGeometryBlock(),
  }
  return (
    rec: PageRec,
    pageIndex: number,
    row: number,
    offsetWords: number,
    floats: Float32Array,
    ints: Uint32Array,
  ) => writeRow(w, rec, pageIndex, row, offsetWords, floats, ints)
}

function writeRow(
  { resources, markRowDirty, roots, rootRank, constants, block }: RowWriter,
  rec: PageRec,
  pageIndex: number,
  row: number,
  offsetWords: number,
  floats: Float32Array,
  ints: Uint32Array,
) {
  const indexCount = rowIndexCount(rec)
  const base = row * (PAGE_INFO_STRIDE / 4),
    material = constants.materialOf(rec.material),
    geo = rowGeometry(rec, resources.geometryBlocks, block)
  const mat = material.mat,
    maps = rowMaterial(mat, geo, resources)
  if (!rec.transparent && shownAsIs(mat.model)) resources.asIsShown = true
  if (!rec.transparent && !resources.emissiveAoShown && surfaceEmitsOrOccludes(mat))
    resources.emissiveAoShown = true
  // Row placement: its world, and its rank, where the temporal pass reads the pixel motion
  // matrix. A packed rank without a placement does not exist in a WebGPU layout: `rootOf` throws.
  const rank = rootRank(pageIndex)
  floats.set(rootOf(roots, rank).world.elements, base)
  writeMaterialWords(floats, ints, base, mat, maps, geo)
  // A page holding more triangles than the identifier's eight low bits would alias the next page.
  assertVisibilityPageTriangles(indexCount / 3, rec.url)
  // A blended cluster's row is a shadow caster's alone (`blendCasters.ts`): its flag and its
  // coverage are what the shadow raster reads of it.
  ints[base + ROW_FLAGS_WORD] = rec.transparent ? maps.flags | FLAG_BLEND_CASTER : maps.flags
  ints[base + 24] = offsetWords
  ints[base + ROW_INDEX_WORDS] = indexCount
  ints[base + ROW_VERTEX_BASE_WORD] = geo?.vertexBase ?? 0
  ints[base + ROW_ID_BASE_WORD] = packedRowBase(row)
  ints[base + 30] = constants.hashOf(rec.clusterId)
  // The Hi-Z verdict of a row lives at the row's own index, and the rows a frame does not test are
  // cleared on the GPU before the test, so no row ever reads the verdict of an earlier image. A
  // row never culled reads none, nor does a deformed one: its box is its rest pose's.
  const deform = resources.deformation?.rowWord(rank) ?? 0
  ints[base + PAGE_DEFORM_WORD] = deform
  writeRowDeformation(ints, base, rec.deformationOutput, offsetWords)
  // An opaque row's lobes record (`PageInfo.physical`): a blended caster's row is never resolved.
  // A float block's second UV set rides in its high bit (`physicalWord`).
  ints[base + PAGE_PHYSICAL_WORD] = rec.transparent
    ? 0
    : physicalWord(
        resources.physicalTable?.rowWord(mat, resources.dataLayer) ?? 0,
        !!geo && !geo.quantized && !!geo.hasUv1,
      )
  ints[base + ROW_HIZ_SLOT_WORD] = neverCulled(mat) || deform ? NO_HIZ_SLOT : row
  ints[base + 47] = pageIndex
  floats[base + 55] = rec.role === 'coarse' ? 1 : 0
  // Depth units to add for this cluster's coplanar layer — engine depth is reversed: zero for
  // layer 0, one calculation source for the hardware path and the software raster alike.
  ints[base + 60] = depthLayerUnits(rec.depthLayer)
  ints[base + ROW_PLACEMENT_WORD] = rank
  markRowDirty(row)
}

/** The row words its surface alone decides: factors, map slots, line and sprite rules, class. */
function writeMaterialWords(
  floats: Float32Array,
  ints: Uint32Array,
  base: number,
  mat: PageSurface,
  maps: ReturnType<typeof rowMaterial>,
  geo: GeometryBlock | undefined,
) {
  floats[base + 16] = mat.baseColor[0]
  floats[base + 17] = mat.baseColor[1]
  floats[base + 18] = mat.baseColor[2]
  // The cutout's threshold (`maskKeep`): a dashed line without an alpha test cuts its gaps alone.
  floats[base + 19] = mat.alphaTest > 0 ? mat.alphaTest : mat.dashSize !== undefined ? 0 : 1
  floats[base + 20] = mat.metalness
  floats[base + 21] = mat.roughness
  ints[base + ROW_MAP_LAYER_WORD] = maps.map
  floats[base + ROW_BLEND_COVERAGE_WORD] = surfaceOpacity(mat)
  // A dashed line's dash and gap (`PageInfo.dash`), zero on every other row.
  floats[base + ROW_DASH_WORD] = mat.dashSize ?? 0
  floats[base + ROW_DASH_WORD + 1] = mat.gapSize ?? 0
  ints[base + 32] = maps.rough
  ints[base + 33] = maps.metal
  ints[base + 34] = maps.normal
  floats[base + 35] = mat.normalScale
  writeSpriteWords(floats, base + ROW_SPRITE_WORD, mat.sprite)
  floats[base + ROW_TRANSMISSION_WORD] = mat.transmission
  floats[base + 39] = mat.thickness
  floats[base + 40] = mat.attenuationColor[0]
  floats[base + 41] = mat.attenuationColor[1]
  floats[base + 44] = mat.attenuationColor[2]
  floats[base + 45] = mat.attenuationDistance
  ints[base + 42] = maps.ao
  floats[base + 43] = mat.aoIntensity
  ints[base + 46] = maps.emissive
  floats.set(mat.emissive, base + 48)
  floats[base + 52] = mat.subsurfaceColor?.[0] ?? 0
  floats[base + 53] = mat.subsurfaceColor?.[1] ?? 0
  floats[base + 58] = mat.subsurfaceColor?.[2] ?? 0
  ints[base + 59] = maps.subsurface
  floats[base + 54] = frameNormalScaleY(mat, !!geo?.hasTangent)
  floats[base + 56] = 0
  floats[base + ROW_LINE_WIDTH_WORD] = mat.lineWidth ?? 0
  // The class the resolve draws this page under: its flags and map slots, as one word.
  ints[base + ROW_MATERIAL_CLASS_WORD] = maps.classKey
}
