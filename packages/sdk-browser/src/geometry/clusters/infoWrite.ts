import { materialWord, type MaterialTable } from '../../materials/table/materialTable.ts'
import type { PageRec } from '../selection/types.ts'
import { depthLayerUnits } from '../../../../sdk-core/src/lod/depthLayer.ts'
import { createClusterHashes } from './hashes.ts'
import {
  emptyGeometryBlock,
  rowGeometry,
  type GeometryBlock,
  type MaterialLayers,
} from '../rows/page/pageRowMaterial.ts'
import { rowFlags } from '../rows/surfaceRow.ts'
import {
  assertVisibilityPageTriangles,
  FLAG_DISTANCE_FIELD,
  FLAG_MASK,
} from '../../visibility/types.ts'
import { displacementProgramOf } from '../../materials/graph/displacementProgram.ts'
import {
  displacementRange,
  displacementReach,
  fadeOutPixels,
} from '../../visibility/tessellation/numbers.ts'
import { shownAsIs } from '../../materials/surface/surfaceModel.ts'
import { surfaceEmitsOrOccludes } from '../../materials/surface/surfaceEmission.ts'
import { rowIndexCount } from '../rows/page/pageRow.ts'
import { pageDiagnosticWord } from '../selection/diagnostic.ts'
import { CLUSTER_INFO, CLUSTER_INFO_WORDS } from '../dag/info/clusterInfoLayout.ts'
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'

/** What writing a cluster record reads of the session: the atlases' slots of its textures, the
 *  geometry blocks of the float pool, and the surfaces' records. */
export type InfoResources = MaterialLayers & {
  geometryBlocks: Map<Geometry['attributes'], GeometryBlock>
  /** Set once an opaque cluster shows a surface as-is (`shownAsIs`): from then on the image has
   *  flags temporal antialiasing and the composition must read (OMB-11). Never unset: a cluster it
   *  no longer draws only keeps the reading variant, which is right for every image. */
  asIsShown: boolean
  /** Set once an opaque cluster's surface can emit or occlude (`surfaceEmitsOrOccludes`): the
   *  image's resolve then writes the emission-and-occlusion layer (`emissiveAoLayer.ts`). Never
   *  unset. */
  emissiveAoShown: boolean
  /** The surfaces' records (`../../materials/table/materialTable.ts`), and what each surface brings
   *  to its clusters, kept with its record (`surface`). */
  materialTable: Pick<MaterialTable, 'surface'>
}

/** What a record write hands back: the words, which the next write overwrites, and the resolve
 *  class the cluster wears. */
export type InfoWritten = { words: Uint32Array; classKey: number }

/**
 * The writer of cluster records (`../dag/info/clusterInfoLayout.ts`): the words of one cluster
 * in its pool slot at `offsetWords`, from its record, its surface and its geometry — every field
 * belongs to the cluster, its material, its geometry block or its slot, none to a placement or to
 * the image. The words are filled again at each write, never allocated again; the longest edge,
 * which the GPU measures, is left zero.
 */
export function createInfoWriter(resources: InfoResources) {
  const hashes = createClusterHashes(),
    block = emptyGeometryBlock(),
    words = new Uint32Array(CLUSTER_INFO_WORDS),
    floats = new Float32Array(words.buffer)
  const at = CLUSTER_INFO.at
  const written: InfoWritten = { words, classKey: 0 }
  return (rec: PageRec, offsetWords: number): InfoWritten => {
    const indexCount = rowIndexCount(rec),
      mat = rec.material,
      geo = rowGeometry(rec, resources.geometryBlocks, block)
    // What its surface brings to every cluster, kept with its record: no map of slots read per
    // write.
    const surface = resources.materialTable.surface(mat, resources),
      maps = rowFlags(surface.row, geo, resources.textures)
    noteShown(resources, rec)
    // A page holding more triangles than the identifier's eight low bits would alias the next page.
    assertVisibilityPageTriangles(indexCount / 3, rec.url)
    words.fill(0)
    words[at.flags] = rec.distanceField ? maps.flags | FLAG_DISTANCE_FIELD : maps.flags
    words[at.pageOffset] = offsetWords
    words[at.indexCount] = indexCount
    words[at.vertexBase] = geo?.vertexBase ?? 0
    words[at.clusterHash] = hashes.hashOf(rec.clusterId)
    // Its surface's record (`PageInfo.material`); a float block's second UV set rides in its high
    // bit (`MATERIAL_SECOND_UV`).
    words[at.material] = materialWord(surface.rank, !!geo && !geo.quantized && !!geo.hasExtraUv)
    // The class the resolve draws this page under: its flags and map slots, as one word.
    words[at.materialClass] = maps.classKey
    // Depth units to add for this cluster's coplanar layer — engine depth is reversed: zero for
    // layer 0, one calculation source for the hardware path and the software raster alike.
    words[at.depthBias] = depthLayerUnits(rec.depthLayer)
    // Its level, its error and its HLOD index as itself; a placement drawn as another HLOD
    // actor lends its own at the decode (`diagnosticDrawnAs`).
    words[at.diagnosticWord] = pageDiagnosticWord(rec)
    // The surface's own offset words, before its object's (`../../geometry/rows/page/offsetRow.ts`).
    words[at.wpo] = surface.row.wpo
    floats[at.wpoMost] = surface.row.wpoMost
    // A displaced surface's reach and the size under which its displacement is gone; none for a masked one, which stays tessellated whatever the size
    // (`fadeOutPixels`, as the shadow maps' fallback to the base triangles reads them).
    const displaced =
      mat.displacement && (mat.displacementMap || displacementProgramOf(mat))
        ? mat.displacement
        : undefined
    if (displaced && (maps.flags & FLAG_MASK) === 0) {
      floats[at.displacementReach] = displacementReach(displacementRange(displaced))
      floats[at.displacementFadeOut] = fadeOutPixels(displaced)
    }
    written.classKey = maps.classKey
    return written
  }
}

/** What the session shows once a drawn opaque cluster's surface does: a pixel shown as it is, a
 *  surface that emits or occludes. */
function noteShown(resources: InfoResources, rec: PageRec) {
  if (rec.transparent) return
  const mat = rec.material
  if (shownAsIs(mat.model)) resources.asIsShown = true
  if (!resources.emissiveAoShown && surfaceEmitsOrOccludes(mat)) resources.emissiveAoShown = true
}
