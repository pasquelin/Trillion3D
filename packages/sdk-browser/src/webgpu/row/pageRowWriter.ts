import { materialWord, type MaterialTable } from '../material/materialTable.ts'
import type { HostAttributes } from '../../host/resources.ts'
import type { PageRec, DeformationOutput } from '../../page/selection/types.ts'
import { depthLayerUnits } from '../../../../sdk-core/src/lod/depthLayer.ts'
import { createPageRowConstants } from './pageRowConstants.ts'
import {
  emptyGeometryBlock,
  rowGeometry,
  type GeometryBlock,
  type MaterialLayers,
} from './pageRowMaterial.ts'
import { rowFlags } from './surfaceRow.ts'
import {
  assertVisibilityPageTriangles,
  FLAG_BLEND_CASTER,
  ROW_WORDS,
} from '../../visibility/types.ts'
import { shownAsIs } from '../../scene/surfaceModel.ts'
import { neverCulled } from '../../visibility/shader/spriteWgsl.ts'
import type { SessionDeformation } from '../../deformation/session.ts'
import { writeRowDeformation } from '../../deformation/outputs.ts'
import { surfaceEmitsOrOccludes } from '../../scene/surfaceEmission.ts'
import { packedRowBase, rowIndexCount } from './pageRow.ts'
import { PAGE_INFO, levelDiagnostic } from '../../visibility/pageInfo.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'

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
  /** The surfaces' records (`../material/materialTable.ts`), and what each surface brings to its
   *  rows, kept with its record (`surface`). */
  materialTable: Pick<MaterialTable, 'surface'>
}
/** What every row write shares, made once with the writer. */
type RowWriter = {
  resources: PageRowResources
  markRowDirty: (row: number) => void
  rootRank: (packed: number) => number
  outputOf: (packed: number) => DeformationOutput | undefined
  // What the catalogue fixes once and for all is not recomputed for every arriving page.
  constants: ReturnType<typeof createPageRowConstants>
  // Filled again at every row write, never allocated again.
  block: GeometryBlock
}

/** The writer of page-table rows (`createPageRowWriter`). */
export type PageRowWriter = ReturnType<typeof createPageRowWriter>

/** Serializes one drawable cluster row after its occupant, slot, or input epoch changes. */
export function createPageRowWriter(
  resources: PageRowResources,
  markRowDirty: (row: number) => void,
  /** The root rank of each packed rank (#1235), -1 for none: the row's placement word and its
   *  deformation record are its instance's root's. */
  rootRank: (packed: number) => number,
  /** Where the placement of a packed rank writes the results of its page (`PackedPages.outputOf`). */
  outputOf: (packed: number) => DeformationOutput | undefined = () => undefined,
) {
  const w: RowWriter = {
    resources,
    markRowDirty,
    rootRank,
    outputOf,
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
  { resources, markRowDirty, rootRank, outputOf, constants, block }: RowWriter,
  rec: PageRec,
  pageIndex: number,
  row: number,
  offsetWords: number,
  floats: Float32Array,
  ints: Uint32Array,
) {
  const indexCount = rowIndexCount(rec)
  const base = row * ROW_WORDS,
    mat = rec.material,
    geo = rowGeometry(rec, resources.geometryBlocks, block)
  // What its surface brings to every row, kept with its record: no map of slots read per row.
  const surface = resources.materialTable.surface(mat, resources),
    maps = rowFlags(surface.row, geo, resources.textures)
  if (!rec.transparent && shownAsIs(mat.model)) resources.asIsShown = true
  if (!rec.transparent && !resources.emissiveAoShown && surfaceEmitsOrOccludes(mat))
    resources.emissiveAoShown = true
  // Row placement: its rank, where the temporal pass reads the pixel motion matrix and the rows
  // pass the world it writes the row's world words from (`../../placement/rowWords.ts`), their
  // one writer. A packed rank without a placement (`rootOfPacked`'s -1) does not exist in a WebGPU
  // layout: refused by name.
  const rank = rootRank(pageIndex)
  if (rank < 0) throw new Error('PAGE_PLACEMENT_MISSING')
  // A page holding more triangles than the identifier's eight low bits would alias the next page.
  assertVisibilityPageTriangles(indexCount / 3, rec.url)
  // A blended cluster's row is a shadow caster's alone (`blendCasters.ts`): its flag and its
  // surface's record are what the shadow raster reads of it.
  ints[base + PAGE_INFO.at.flags] = rec.transparent ? maps.flags | FLAG_BLEND_CASTER : maps.flags
  ints[base + PAGE_INFO.at.pageOffset] = offsetWords
  ints[base + PAGE_INFO.at.indexCount] = indexCount
  ints[base + PAGE_INFO.at.vertexBase] = geo?.vertexBase ?? 0
  ints[base + PAGE_INFO.at.packedBase] = packedRowBase(row)
  ints[base + PAGE_INFO.at.clusterHash] = constants.hashOf(rec.clusterId)
  // The Hi-Z verdict of a row lives at the row's own index, and the rows a frame does not test are
  // cleared on the GPU before the test, so no row ever reads the verdict of an earlier image. A
  // row never culled reads none, nor does a deformed one: its box is its rest pose's.
  const deform = resources.deformation?.rowWord(rank) ?? 0
  ints[base + PAGE_INFO.at.deform] = deform
  writeRowDeformation(ints, base, outputOf(pageIndex))
  // Its surface's record (`PageInfo.material`); a float block's second UV set rides in its high
  // bit (`MATERIAL_SECOND_UV`).
  ints[base + PAGE_INFO.at.material] = materialWord(
    surface.rank,
    !!geo && !geo.quantized && !!geo.hasUv1,
  )
  ints[base + PAGE_INFO.at.hizSlot] = neverCulled(mat) || deform ? NO_INDEX : row
  ints[base + PAGE_INFO.at.selectionIndex] = pageIndex
  floats[base + PAGE_INFO.at.diagnostic] = levelDiagnostic(rec)
  // Depth units to add for this cluster's coplanar layer — engine depth is reversed: zero for
  // layer 0, one calculation source for the hardware path and the software raster alike.
  ints[base + PAGE_INFO.at.depthBias] = depthLayerUnits(rec.depthLayer)
  ints[base + PAGE_INFO.at.placement] = rank
  // The class the resolve draws this page under: its flags and map slots, as one word.
  ints[base + PAGE_INFO.at.materialClass] = maps.classKey
  markRowDirty(row)
}
