import type { HostDrawCamera } from '../../camera/world.ts';
import {
  drawPasses,
  recordTriangles,
  wholeMeshTriangles,
  type ClusterDrawMesh,
  type WholeMesh,
} from '../../cluster/batchMesh.ts';
import type { ClusterBatchStats, ClusterDrawOwner } from '../../cluster/batches.ts';
import { firstMaterial } from '../../scene/materialSide.ts';
import type { SceneCopy } from './copyCulling.ts';
import type { WebglClusterScene } from './lights.ts';

/** The host scene the owner reads for its lights and background, its world matrices resolved
 *  before the read. */
export type ClusterDrawScene = WebglClusterScene & { updateMatrixWorld(): void };

/** Submissions a material asks for this frame: none while hidden, otherwise its passes. */
const passCount = (material: WholeMesh['material']) =>
  firstMaterial(material)?.visible ? drawPasses(material).length : 0;

export function drawClusterBatches(
  owner: ClusterDrawOwner,
  active: readonly { mesh?: ClusterDrawMesh }[],
  diagnosticMeshes: readonly WholeMesh[],
  copies: readonly SceneCopy[],
  scene: ClusterDrawScene,
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
  // With a transmissive copy in view, the frame was drawn once more into the backdrop.
  const frames = 1 + owner.backdropPasses;
  for (const mesh of meshes) {
    const passes = passCount(mesh.material) * frames;
    stats.subDraws += mesh._multiDrawCount * passes;
    stats.submittedTriangles += recordTriangles(mesh) * passes;
  }
  for (const mesh of diagnosticMeshes) {
    const passes = passCount(mesh.material) * frames;
    stats.subDraws += passes;
    stats.submittedTriangles += wholeMeshTriangles(mesh) * passes;
  }
  // Copies are not paged clusters: the cluster counters leave them out. The session counter
  // stays a count of display submissions; the frame's draw calls include the backdrop pass.
  stats.copyDraws = owner.copySubmissions;
  stats.drawCalls = submitted + owner.backdropSubmissions;
  stats.cpuSubmitMs = performance.now() - start;
  stats.autonomousClusterDrawsTotal += submitted;
  stats.backdropBytes = owner.backdropBytes;
}
