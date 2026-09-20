import type { ClusterDrawMesh } from './clusterBatchMesh.ts';
import { clusterMaterialReason } from './webglClusterCompatibility.ts';

type Material = Exclude<ClusterDrawMesh['material'], unknown[]>;

export function validateClusterMeshes(meshes: readonly ClusterDrawMesh[], seen: Set<Material>) {
  seen.clear();
  for (const mesh of meshes) {
    if (Array.isArray(mesh.material) || seen.has(mesh.material)) continue;
    const reason = clusterMaterialReason(mesh.material, mesh.geometry.attributes);
    if (reason) throw new Error(`Unsupported autonomous cluster material: ${reason}`);
    seen.add(mesh.material);
  }
}
