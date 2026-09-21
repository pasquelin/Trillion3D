import type { ClusterDrawMesh, HostAttributes, WholeMesh } from './clusterBatchMesh.ts';
import { clusterMaterialReason } from './webglClusterCompatibility.ts';
import { refuseCluster as refuse } from './webglClusterRefusal.ts';
import type { Material } from './webglClusterMaterialBinding.ts';

const validateMeshes = (
  meshes: readonly (ClusterDrawMesh | WholeMesh)[],
  seen: Map<Material, HostAttributes>,
  transmissive: boolean,
) => {
  for (const mesh of meshes) {
    const { material } = mesh,
      attributes = mesh.geometry.attributes;
    if (Array.isArray(material)) refuse('material arrays are unsupported');
    const previous = seen.get(material);
    if (previous === attributes) continue;
    const reason = clusterMaterialReason(material, attributes, transmissive);
    if (reason) refuse(reason);
    if (!previous) seen.set(material, attributes);
  }
};

/**
 * Refuses every mesh of the frame before any of them is submitted: no partial image. Only the
 * copies of the transmission pass may transmit; a page or a plain copy that does is refused.
 */
export function validateClusterMeshes(
  meshes: readonly ClusterDrawMesh[],
  wholeMeshes: readonly WholeMesh[],
  copies: {
    plain: readonly WholeMesh[];
    blended: readonly WholeMesh[];
    transmissive: readonly WholeMesh[];
  },
  seen: Map<Material, HostAttributes>,
) {
  seen.clear();
  validateMeshes(meshes, seen, false);
  validateMeshes(wholeMeshes, seen, false);
  validateMeshes(copies.plain, seen, false);
  validateMeshes(copies.blended, seen, false);
  validateMeshes(copies.transmissive, seen, true);
}
