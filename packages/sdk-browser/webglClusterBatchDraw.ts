import type * as THREE from 'three';
import type { HostDrawCamera } from './cameraWorld.ts';
import type { ClusterDrawMesh } from './clusterBatchMesh.ts';
import type { ClusterBatchStats, ClusterDrawOwner } from './clusterBatches.ts';

const wholeMeshTriangles = (mesh: THREE.Mesh) =>
  (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;

export function drawClusterBatches(
  owner: ClusterDrawOwner,
  active: readonly { mesh?: ClusterDrawMesh }[],
  diagnosticMeshes: readonly THREE.Mesh[],
  copies: readonly THREE.Mesh[],
  scene: THREE.Scene,
  camera: HostDrawCamera,
  toneMapped: boolean,
  srgbDestination: boolean,
  stats: ClusterBatchStats,
) {
  scene.updateMatrixWorld();
  const meshes: ClusterDrawMesh[] = [];
  for (const group of active) if (group.mesh) meshes.push(group.mesh);
  const start = performance.now();
  const submitted = owner.draw(
    meshes,
    scene,
    camera,
    toneMapped,
    srgbDestination,
    diagnosticMeshes,
    copies,
  );
  stats.subDraws = 0;
  stats.submittedTriangles = 0;
  stats.copyDraws = 0;
  for (const mesh of meshes) {
    let passes = 0;
    if (Array.isArray(mesh.material)) {
      if (mesh._sideSplitSource?.visible) passes = 2;
    } else if (mesh.material.visible) passes = 1;
    stats.subDraws += mesh._multiDrawCount * passes;
    let indices = 0;
    for (let i = 0; i < mesh._multiDrawCount; i++) indices += mesh._multiDrawCounts[i];
    stats.submittedTriangles += (indices / 3) * passes;
  }
  for (const mesh of diagnosticMeshes) {
    if (Array.isArray(mesh.material) || !mesh.material.visible) continue;
    stats.subDraws++;
    stats.submittedTriangles += wholeMeshTriangles(mesh);
  }
  for (const mesh of copies)
    if (!Array.isArray(mesh.material) && mesh.material.visible) stats.copyDraws++;
  // Copies are not paged clusters: the cluster counters leave them out.
  stats.drawCalls = submitted - stats.copyDraws;
  stats.cpuSubmitMs = performance.now() - start;
  stats.autonomousClusterDrawsTotal += stats.drawCalls;
  stats.backdropBytes = owner.backdropBytes;
}
