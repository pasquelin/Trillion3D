import type { BackendContext } from './backendTypes.ts';
import { ClusterBatches, type BatchPage } from './clusterBatches.ts';
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
 * still compose on the host pass, and both keep their source geometry and material for the
 * diagnostic modes to restore.
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
  return { batches, refusal };
}
