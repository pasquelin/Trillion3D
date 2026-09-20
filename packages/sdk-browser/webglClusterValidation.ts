import type { ClusterDrawMesh } from './clusterBatchMesh.ts';
import { clusterMaterialReason } from './webglClusterCompatibility.ts';
import type * as THREE from 'three';

type Material = Exclude<ClusterDrawMesh['material'], unknown[]>;
type Attributes = ClusterDrawMesh['geometry']['attributes'];

const validateMaterial = (
  material: Material,
  attributes: Attributes,
  seen: Map<Material, Attributes>,
) => {
  const previous = seen.get(material);
  if (previous === attributes) return;
  const reason = clusterMaterialReason(material, attributes);
  if (reason) throw new Error(`Unsupported autonomous cluster material: ${reason}`);
  if (!previous) seen.set(material, attributes);
};

export function validateClusterMeshes(
  meshes: readonly ClusterDrawMesh[],
  diagnosticMeshes: readonly THREE.Mesh[],
  seen: Map<Material, Attributes>,
) {
  seen.clear();
  for (const mesh of meshes) {
    if (Array.isArray(mesh.material)) {
      if (mesh.material !== mesh._sideSplitMaterials)
        throw new Error('Unsupported autonomous cluster material: material arrays are unsupported');
      if (
        mesh.material.length !== 2 ||
        mesh.material[0] !== mesh._sideSplitBack ||
        mesh.material[1] !== mesh._sideSplitFront ||
        mesh.material[0].side !== 1 ||
        mesh.material[1].side !== 0 ||
        !mesh.material[0].transparent ||
        !mesh.material[1].transparent
      )
        throw new Error('Unsupported autonomous cluster material: invalid sideSplit pass order');
      for (const material of mesh.material)
        validateMaterial(material, mesh.geometry.attributes, seen);
    } else validateMaterial(mesh.material, mesh.geometry.attributes, seen);
  }
  for (const mesh of diagnosticMeshes) {
    if (Array.isArray(mesh.material))
      throw new Error('Unsupported autonomous cluster material: material arrays are unsupported');
    const reason = clusterMaterialReason(mesh.material, mesh.geometry.attributes);
    if (reason) throw new Error(`Unsupported autonomous cluster material: ${reason}`);
  }
}
