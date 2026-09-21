import type { ClusterDrawMesh } from './clusterBatchMesh.ts';
import { clusterMaterialReason } from './webglClusterCompatibility.ts';
import { refuseCluster as refuse } from './webglClusterRefusal.ts';
import type { Material } from './webglClusterMaterialBinding.ts';
import type * as THREE from 'three';

type Attributes = ClusterDrawMesh['geometry']['attributes'];

const validateMaterial = (
  material: Material,
  attributes: Attributes,
  seen: Map<Material, Attributes>,
  transmissive = false,
) => {
  const previous = seen.get(material);
  if (previous === attributes) return;
  const reason = clusterMaterialReason(material, attributes, transmissive);
  if (reason) refuse(reason);
  if (!previous) seen.set(material, attributes);
};

const validateWholeMesh = (
  mesh: THREE.Mesh,
  seen: Map<Material, Attributes>,
  transmissive: boolean,
) => {
  if (Array.isArray(mesh.material)) refuse('material arrays are unsupported');
  else validateMaterial(mesh.material, mesh.geometry.attributes, seen, transmissive);
};

/**
 * Refuses every mesh of the frame before any of them is submitted: no partial image. Only the
 * copies of the transmission pass may transmit; a page or a plain copy that does is refused.
 */
export function validateClusterMeshes(
  meshes: readonly ClusterDrawMesh[],
  wholeMeshes: readonly THREE.Mesh[],
  plainCopies: readonly THREE.Mesh[],
  transmissiveCopies: readonly THREE.Mesh[],
  seen: Map<Material, Attributes>,
) {
  seen.clear();
  for (const mesh of meshes) {
    if (Array.isArray(mesh.material)) {
      if (mesh.material !== mesh._sideSplitMaterials) refuse('material arrays are unsupported');
      const source = mesh._sideSplitSource;
      if (
        !source ||
        mesh.material.length !== 2 ||
        mesh.material[0] !== mesh._sideSplitBack ||
        mesh.material[1] !== mesh._sideSplitFront ||
        (mesh._sideSplitPolygonMaterials !== undefined &&
          mesh._sideSplitPolygonMaterials !== mesh.material) ||
        mesh.material[0].side !== 1 ||
        mesh.material[1].side !== 0 ||
        !mesh.material[0].transparent ||
        !mesh.material[1].transparent
      )
        refuse('invalid sideSplit pass order');
      validateMaterial(source, mesh.geometry.attributes, seen);
      if (!source.transparent || source.side !== 2 || source.forceSinglePass)
        refuse('mutated sideSplit source');
      for (const material of mesh.material)
        validateMaterial(material, mesh.geometry.attributes, seen);
    } else validateMaterial(mesh.material, mesh.geometry.attributes, seen);
  }
  for (const mesh of wholeMeshes) validateWholeMesh(mesh, seen, false);
  for (const mesh of plainCopies) validateWholeMesh(mesh, seen, false);
  for (const mesh of transmissiveCopies) validateWholeMesh(mesh, seen, true);
}
