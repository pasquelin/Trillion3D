// Oracle, scene side: `packages/sdk-browser/src/world/scene/scene.ts:18-36`, copied as-is (the
// page-source side is in `manifest-index.ts`).
import * as THREE from 'three'
import type { HostMesh } from '../../../packages/sdk-browser/src/host/resources.ts'
import type { ClusterManifest } from '../../../packages/sdk-core/src/index.ts'
import type { DrawAssociations } from '../../../packages/sdk-browser/src/page/selection/drawSource.ts'
import { meshes } from '../../../packages/sdk-browser/src/scene/meshes.ts'
import type { Object3D } from '../../../packages/sdk-core/src/world/object/object3d.ts'

/** The manifest primitive `mesh` is associated with, found as the scene and the page collection
 *  find it: one `find` over the primitives. */
export function referencePrimitiveOf(
  metadata: ClusterManifest,
  associations: ReadonlyMap<unknown, { meshes?: number; primitives?: number }>,
  mesh: HostMesh,
) {
  const association = associations.get(mesh)
  return metadata.primitives.find(
    (item) =>
      item.mesh === association?.meshes && item.primitive === (association?.primitives ?? 0),
  )
}

/** `pagesBounds`: one `find` per mesh, three objects per exact page. */
export function referenceExactPagesBounds(
  source: Object3D,
  associations: DrawAssociations,
  metadata: ClusterManifest,
  onMissing: (mesh: HostMesh) => void,
  into = new THREE.Box3(),
) {
  // `meshes` resolved the host subtree before batch 8; the witness now resolves it
  // itself, since it reads `matrixWorld` — what it computes does not change by a bit.
  source.updateMatrixWorld(true)
  for (const mesh of meshes(source)) {
    const primitive = referencePrimitiveOf(metadata, associations, mesh)
    if (!primitive) {
      onMissing(mesh)
      continue
    }
    for (const page of primitive.pages)
      if ((page.role ?? 'exact') === 'exact')
        into.union(
          new THREE.Box3(
            new THREE.Vector3().fromArray(page.min),
            new THREE.Vector3().fromArray(page.max),
          ).applyMatrix4(new THREE.Matrix4().fromArray(mesh.matrixWorld.elements)),
        )
  }
  return into
}
