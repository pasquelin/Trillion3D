import { meshes as objects } from '../../scene/meshes.ts'
import type { HostBoundedNode } from '../../host/scene/graphNodes.ts'
import type { HostMesh } from '../../host/resources.ts'
import { primitiveFinder } from '../../scene/primitiveLookup.ts'
import { emptyWorldBox } from '../../host/world/bounds.ts'
import { type ClusterManifest } from '../../../../sdk-core/src/index.ts'
import type { BoxTransformLot } from '../../page/decode/batch/batchRuntime.ts'
import { boxUnionCollector } from '../../page/selection/batchBoxes.ts'
import type { EngineContext } from '../../engine/types.ts'
import { hostWorldPlacements } from '../../host/world/placements.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'

/**
 * World bounds of the exact pages of a prepared scene: not those of the host geometries but those
 * the compiler wrote page by page.
 *
 * World matrices are the transform tree's after its frame pass (`pass.ts`), as host bounds read
 * them: a pose written without composition is taken as-is. Transform and union are the core's,
 * term for term.
 */

/** A manifest page carries exact bounds, or is only a coarse approximation. */
type ManifestPage = ClusterManifest['primitives'][number]['pages'][number]
const exacte = (item: ManifestPage) => (item.role ?? 'exact') === 'exact'

/** Manifest bounds written flat, six floats from `at`. */
function ecritPage(out: Float64Array, at: number, item: ManifestPage) {
  out[at] = item.min[0]
  out[at + 1] = item.min[1]
  out[at + 2] = item.min[2]
  out[at + 3] = item.max[0]
  out[at + 4] = item.max[1]
  out[at + 5] = item.max[2]
}

/** The box a mesh placed by rows holds for every row (`host/prepared/placed.ts`): its pages
 *  bound one placement, and its own pose places none. */
function placedBox(mesh: HostMesh, associations: EngineContext['associations']) {
  return associations.get(mesh)?.placements ? (mesh as HostBoundedNode).boundingBox : undefined
}

/** Exact pages of `source`: the EXACT size the box lot must carry. A mesh placed by rows counts
 * its box whether or not the view read its primitive yet. */
function exactPagesCount(
  source: Object3D,
  associations: EngineContext['associations'],
  metadata: ClusterManifest,
) {
  const primitiveOf = primitiveFinder(metadata.primitives)
  let n = 0
  for (const mesh of objects(source)) {
    const primitive = primitiveOf(associations.get(mesh))
    if (placedBox(mesh, associations)) n++
    else if (primitive) for (const item of primitive.pages) if (exacte(item)) n++
  }
  return n
}

/** World bounds of the exact pages of every mesh of `source`, flat `[minX..maxZ]`: a mesh placed
 * by rows by the box they place it in, whether or not the view read its primitive yet.
 *  `onMissing` decides what another mesh without a prepared primitive does; it is skipped once
 *  that returns. */
export function pagesBounds(
  source: Object3D,
  associations: EngineContext['associations'],
  metadata: ClusterManifest,
  onMissing: (mesh: HostMesh) => void,
  into = emptyWorldBox(),
  lot?: BoxTransformLot | null,
) {
  const primitiveOf = primitiveFinder(metadata.primitives)
  const union = boxUnionCollector(into, lot, exactPagesCount(source, associations, metadata))
  const worlds = hostWorldPlacements(source)
  for (const mesh of objects(source)) {
    const primitive = primitiveOf(associations.get(mesh))
    const placed = placedBox(mesh, associations)
    if (!primitive && !placed) {
      onMissing(mesh)
      continue
    }
    // The world matrix is the one the engine computed for this mesh, read once.
    const world = worlds.of(mesh).elements
    if (placed) {
      const { min, max } = placed
      union.boxes.set([min.x, min.y, min.z, max.x, max.y, max.z], union.at)
      union.pose(world)
      continue
    }
    for (const item of primitive!.pages)
      if (exacte(item)) {
        ecritPage(union.boxes, union.at, item)
        union.pose(world)
      }
  }
  return union.ferme()
}
