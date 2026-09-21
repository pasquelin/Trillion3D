import type { BackendContext, HostDrawOutput } from './backendTypes.ts';
import type { HostCamera, HostDrawCamera } from './cameraWorld.ts';
import { ClusterBatches, type BatchPage } from './clusterBatches.ts';
import { createThreeSceneDraw } from './threeSceneAdapter.ts';
import { clusterWebglCompatibility, ownedSceneCopy } from './webglClusterCompatibility.ts';
import { clusterRefusal } from './webglClusterRefusal.ts';
import { WebglClusterOwner } from './webglClusterOwner.ts';

type HostScene = ConstructorParameters<typeof ClusterBatches>[0];
type SceneCopy = NonNullable<ConstructorParameters<typeof ClusterBatches>[3]>[number];

/**
 * The batches of a prepared scene and their one draw owner. A scene the owner cannot draw in
 * full is refused by name — `refusal` fails the preparation and every draw — since nothing else
 * draws paged clusters and a partial image is not an option. Without a context there is no
 * owner: the cut still runs, the draw is refused.
 *
 * A transmissive copy is the owner's and never enters the host scene; the other blended copies
 * still compose on the host pass — the scene the witness adapter draws after the owner, until
 * the owner submits them (#85) —, and both keep their source geometry and material for the
 * diagnostic modes to restore. `hostDraw` is the engine's whole draw: the owner, then that scene.
 */
export function createExactPagesClusterBatches(
  scene: HostScene,
  pages: readonly BatchPage[],
  blendCopies: readonly SceneCopy[],
  context: Pick<BackendContext, 'webglContext'>,
) {
  const gl = context.webglContext;
  const reason = gl && clusterWebglCompatibility(gl, pages, blendCopies, scene);
  const refusal = reason ? clusterRefusal(reason) : undefined;
  const owner = gl && !refusal ? new WebglClusterOwner(gl) : undefined;
  const transmissive: SceneCopy[] = [];
  for (const copy of blendCopies) {
    copy.userData.sourceGeometry = copy.geometry;
    copy.userData.sourceMaterial = copy.material;
    if (ownedSceneCopy(copy)) transmissive.push(copy);
    else scene.add(copy);
  }
  const batches = new ClusterBatches(scene, pages, owner, transmissive);
  const sceneDraw = createThreeSceneDraw(gl, scene);
  const hostDraw = {
    render: (camera: HostCamera) => sceneDraw.render(camera),
    drawHostGeometry(camera: HostDrawCamera, output: HostDrawOutput) {
      if (refusal) throw refusal;
      batches.draw(camera, output.toneMapped, output.encodeSrgb);
      sceneDraw.drawHostGeometry(camera, output);
    },
    dispose: sceneDraw.dispose,
  };
  return { batches, refusal, ownedCopies: transmissive.length, hostDraw };
}
