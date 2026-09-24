import type { HostDrawCamera } from '../../../../packages/sdk-browser/src/camera/world.ts';
import {
  drawPasses,
  recordTriangles,
  wholeMeshTriangles,
  type ClusterDrawMesh,
  type WholeMesh,
} from '../../../../packages/sdk-browser/src/cluster/batchMesh.ts';
import type { ClusterBatchStats, ClusterDrawOwner } from './batches.ts';
import { firstMaterial } from '../../../../packages/sdk-browser/src/scene/materialSide.ts';
import type { SceneCopy } from '../../../../packages/sdk-browser/src/webgl/cluster/copyCulling.ts';
import type { GraphNode } from '../../../../packages/sdk-browser/src/host/graph/node.ts';
import type { ClusterDrawScene } from '../../../../packages/sdk-browser/src/webgl/cluster/sceneDraw.ts';

/** A scene copy of the witness: a mesh of no graph, its world resolved by the draw itself. */
export type BatchCopy = SceneCopy & Pick<GraphNode, 'updateWorldMatrix'>;

/** Submissions a material asks for this frame: none while hidden, otherwise its passes. */
const passCount = (material: WholeMesh['material']) =>
  firstMaterial(material)?.visible ? drawPasses(material).length : 0;

export function drawClusterBatches(
  owner: ClusterDrawOwner,
  active: readonly { mesh?: ClusterDrawMesh }[],
  diagnosticMeshes: readonly WholeMesh[],
  copies: readonly BatchCopy[],
  scene: ClusterDrawScene,
  camera: HostDrawCamera,
  toneMapped: boolean,
  srgbDestination: boolean,
  stats: ClusterBatchStats,
) {
  scene.updateMatrixWorld();
  // The copies enter no graph, so no graph resolves their world: each reads its pose — the
  // engine's world storage, rewritten by a move — into the world matrix the owner culls and
  // draws with, every frame.
  for (const copy of copies) copy.updateWorldMatrix(false, false);
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
