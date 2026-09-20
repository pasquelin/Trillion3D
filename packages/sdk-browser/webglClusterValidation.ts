import type { ClusterDrawMesh } from './clusterBatchMesh.ts';
import { clusterMaterialReason, ownedSceneCopy } from './webglClusterCompatibility.ts';
import type * as THREE from 'three';

type Material = Exclude<ClusterDrawMesh['material'], unknown[]>;
type Attributes = ClusterDrawMesh['geometry']['attributes'];

function refuse(reason: string): never {
  throw new Error(`Unsupported autonomous cluster material: ${reason}`);
}

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

const validateWholeMesh = (mesh: THREE.Mesh, seen: Map<Material, Attributes>) => {
  if (Array.isArray(mesh.material)) refuse('material arrays are unsupported');
  else validateMaterial(mesh.material, mesh.geometry.attributes, seen, ownedSceneCopy(mesh));
};

/** Refuses every mesh of the frame before any of them is submitted: no partial image. */
export function validateClusterMeshes(
  meshes: readonly ClusterDrawMesh[],
  wholeMeshes: readonly THREE.Mesh[],
  copies: readonly THREE.Mesh[],
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
  for (const mesh of wholeMeshes) validateWholeMesh(mesh, seen);
  for (const mesh of copies) validateWholeMesh(mesh, seen);
}
