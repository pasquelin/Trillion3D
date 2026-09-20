import type { ClusterDrawMesh } from './clusterBatchMesh.ts';
import { clusterMaterialReason } from './webglClusterCompatibility.ts';

type Material = Exclude<ClusterDrawMesh['material'], unknown[]>;
type Attributes = ClusterDrawMesh['geometry']['attributes'];

export function validateClusterMeshes(
  meshes: readonly ClusterDrawMesh[],
  seen: Map<Material, Set<Attributes>>,
) {
  for (const attributes of seen.values()) attributes.clear();
  for (const mesh of meshes) {
    if (Array.isArray(mesh.material)) continue;
    let attributes = seen.get(mesh.material);
    if (!attributes) {
      attributes = new Set();
      seen.set(mesh.material, attributes);
    }
    if (attributes.has(mesh.geometry.attributes)) continue;
    const reason = clusterMaterialReason(mesh.material, mesh.geometry.attributes);
    if (reason) throw new Error(`Unsupported autonomous cluster material: ${reason}`);
    attributes.add(mesh.geometry.attributes);
  }
}
