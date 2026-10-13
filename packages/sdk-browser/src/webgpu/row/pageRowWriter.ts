import { physicalWord, type PhysicalTable } from '../visibility/physicalTable.ts'
import type { HostAttributes } from '../../host/resources.ts'
import { rootOf, type PageRec } from '../../page/selection/selection.ts'
import type { Placements } from '../../page/selection/placements.ts'
import type { DeformationOutput } from '../../page/selection/types.ts'
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
  ROW_WORDS,
} from '../../visibility/types.ts'
import { frameNormalScaleY } from '../../visibility/frameNormal.ts'
import { surfaceOpacity, type PageSurface } from '../../page/surface.ts'
import { shownAsIs } from '../../scene/surfaceModel.ts'
import { neverCulled, writeSpriteWords } from '../../visibility/shader/spriteWgsl.ts'
import type { SessionDeformation } from '../../deformation/session.ts'
import { writeRowDeformation } from '../../deformation/outputs.ts'
import { surfaceEmitsOrOccludes } from '../../scene/surfaceEmission.ts'
import { packedRowBase, rowIndexCount } from './pageRow.ts'
import { PAGE_INFO } from '../../visibility/pageInfo.ts'
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
  /** The surfaces' anisotropic and clear-coat records (`../visibility/physicalTable.ts`). */
  physicalTable?: Pick<PhysicalTable, 'rowWord'>
}
/** What every row write shares, made once with the writer. */
type RowWriter = {
  resources: PageRowResources
  markRowDirty: (row: number) => void
  roots: Placements
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
  /** The placement roots, and the root rank of each packed rank (#1235): the row's world, its
   *  placement word and its deformation record are its instance's root's. */
  roots: Placements,
  rootRank: (packed: number) => number,
  /** Where the placement of a packed rank writes the results of its page (`PackedPages.outputOf`). */
  outputOf: (packed: number) => DeformationOutput | undefined = () => undefined,
) {
  const w: RowWriter = {
    ...{ resources, markRowDirty, roots, rootRank, outputOf },
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
  { resources, markRowDirty, roots, rootRank, outputOf, constants, block }: RowWriter,
  rec: PageRec,
  pageIndex: number,
  row: number,
  offsetWords: number,
  floats: Float32Array,
  ints: Uint32Array,
) {
  const indexCount = rowIndexCount(rec)
  const base = row * ROW_WORDS,
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
  // An opaque row's lobes record (`PageInfo.physical`): a blended caster's row is never resolved.
  // A float block's second UV set rides in its high bit (`physicalWord`).
  ints[base + PAGE_INFO.at.physical] = rec.transparent
    ? 0
    : physicalWord(
        resources.physicalTable?.rowWord(mat, resources.dataLayer) ?? 0,
        !!geo && !geo.quantized && !!geo.hasUv1,
      )
  ints[base + PAGE_INFO.at.hizSlot] = neverCulled(mat) || deform ? NO_INDEX : row
  ints[base + PAGE_INFO.at.selectionIndex] = pageIndex
  floats[base + PAGE_INFO.at.pad1] = rec.role === 'coarse' ? 1 : 0
  // Depth units to add for this cluster's coplanar layer — engine depth is reversed: zero for
  // layer 0, one calculation source for the hardware path and the software raster alike.
  ints[base + PAGE_INFO.at.depthBias] = depthLayerUnits(rec.depthLayer)
  ints[base + PAGE_INFO.at.placement] = rank
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
  floats[base + PAGE_INFO.at.baseColor] = mat.baseColor[0]
  floats[base + PAGE_INFO.at.baseColor + 1] = mat.baseColor[1]
  floats[base + PAGE_INFO.at.baseColor + 2] = mat.baseColor[2]
  // The cutout's threshold (`maskKeep`): a dashed line without an alpha test cuts its gaps alone.
  floats[base + PAGE_INFO.at.baseColor + 3] =
    mat.alphaTest > 0 ? mat.alphaTest : mat.dashSize !== undefined ? 0 : 1
  floats[base + PAGE_INFO.at.metalness] = mat.metalness
  floats[base + PAGE_INFO.at.roughness] = mat.roughness
  ints[base + PAGE_INFO.at.mapIndex] = maps.map
  floats[base + PAGE_INFO.at.blendCoverage] = surfaceOpacity(mat)
  // A dashed line's dash and gap (`PageInfo.dash`), zero on every other row.
  floats[base + PAGE_INFO.at.dash] = mat.dashSize ?? 0
  floats[base + PAGE_INFO.at.dash + 1] = mat.gapSize ?? 0
  ints[base + PAGE_INFO.at.roughnessIndex] = maps.rough
  ints[base + PAGE_INFO.at.metalnessIndex] = maps.metal
  ints[base + PAGE_INFO.at.normalIndex] = maps.normal
  floats[base + PAGE_INFO.at.normalScale] = mat.normalScale
  writeSpriteWords(floats, base + PAGE_INFO.at.sprite, mat.sprite)
  floats[base + PAGE_INFO.at.transmission] = mat.transmission
  floats[base + PAGE_INFO.at.thickness] = mat.thickness
  floats[base + PAGE_INFO.at.attenuationRG] = mat.attenuationColor[0]
  floats[base + PAGE_INFO.at.attenuationRG + 1] = mat.attenuationColor[1]
  floats[base + PAGE_INFO.at.attenuationB] = mat.attenuationColor[2]
  floats[base + PAGE_INFO.at.attenuationDistance] = mat.attenuationDistance
  ints[base + PAGE_INFO.at.aoIndex] = maps.ao
  floats[base + PAGE_INFO.at.aoIntensity] = mat.aoIntensity
  ints[base + PAGE_INFO.at.emissiveIndex] = maps.emissive
  floats.set(mat.emissive, base + PAGE_INFO.at.emissive)
  floats[base + PAGE_INFO.at.subsurfaceRG] = mat.subsurfaceColor?.[0] ?? 0
  floats[base + PAGE_INFO.at.subsurfaceRG + 1] = mat.subsurfaceColor?.[1] ?? 0
  floats[base + PAGE_INFO.at.subsurfaceB] = mat.subsurfaceColor?.[2] ?? 0
  ints[base + PAGE_INFO.at.subsurfaceMap] = maps.subsurface
  floats[base + PAGE_INFO.at.normalScaleY] = frameNormalScaleY(mat, !!geo?.hasTangent)
  floats[base + PAGE_INFO.at.screenError] = 0
  floats[base + PAGE_INFO.at.lineWidth] = mat.lineWidth ?? 0
  // The class the resolve draws this page under: its flags and map slots, as one word.
  ints[base + PAGE_INFO.at.materialClass] = maps.classKey
}
