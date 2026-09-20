import type * as THREE from 'three';
import type { HostDrawCamera } from './cameraWorld.ts';
import type { ClusterDrawMesh } from './clusterBatchMesh.ts';
import type { ClusterBatchStats } from './clusterBatches.ts';
import type { WebglClusterOwner } from './webglClusterOwner.ts';

export function drawClusterBatches(
  renderer: WebglClusterOwner,
  active: readonly { mesh?: ClusterDrawMesh }[],
  diagnosticMeshes: readonly THREE.Mesh[],
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
  const submitted = renderer.draw(
    meshes,
    scene,
    camera,
    toneMapped,
    srgbDestination,
    diagnosticMeshes,
  );
  stats.drawCalls = submitted;
  stats.subDraws = 0;
  stats.submittedTriangles = 0;
  for (const mesh of meshes) {
    let passes = 0;
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) if (material.visible) passes++;
    } else if (mesh.material.visible) passes = 1;
    stats.subDraws += mesh._multiDrawCount * passes;
    let indices = 0;
    for (let i = 0; i < mesh._multiDrawCount; i++) indices += mesh._multiDrawCounts[i];
    stats.submittedTriangles += (indices / 3) * passes;
  }
  for (const mesh of diagnosticMeshes) {
    if (Array.isArray(mesh.material) || !mesh.material.visible) continue;
    const indices = mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count;
    stats.subDraws++;
    stats.submittedTriangles += indices / 3;
  }
  stats.cpuSubmitMs = performance.now() - start;
  stats.autonomousClusterDrawsTotal += submitted;
}
