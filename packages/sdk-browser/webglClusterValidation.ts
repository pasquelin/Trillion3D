import type { ClusterDrawMesh } from './clusterBatchMesh.ts';
import { clusterMaterialReason } from './webglClusterCompatibility.ts';

type Material = Exclude<ClusterDrawMesh['material'], unknown[]>;
type Attributes = ClusterDrawMesh['geometry']['attributes'];

export function validateClusterMeshes(
  meshes: readonly ClusterDrawMesh[],
  seen: Map<Material, Attributes>,
) {
  seen.clear();
  for (const mesh of meshes) {
    if (Array.isArray(mesh.material))
      throw new Error('Unsupported autonomous cluster material: material arrays are unsupported');
    const attributes = seen.get(mesh.material);
    if (attributes === mesh.geometry.attributes) continue;
    const reason = clusterMaterialReason(mesh.material, mesh.geometry.attributes);
    if (reason) throw new Error(`Unsupported autonomous cluster material: ${reason}`);
    if (!attributes) seen.set(mesh.material, mesh.geometry.attributes);
  }
}
