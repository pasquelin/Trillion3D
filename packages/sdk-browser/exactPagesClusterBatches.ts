import { DEFAULT_TONE_MAPPING, TONE_MAPPING_RANK } from '../sdk-core/sceneEnvironment.ts';
import type { BackendContext, HostDrawOutput } from './backendTypes.ts';
import type { HostDrawCamera } from './cameraWorld.ts';
import { ClusterBatches, type BatchPage } from './clusterBatches.ts';
import { clusterWebglCompatibility } from './webglClusterCompatibility.ts';
import { clusterRefusal } from './webglClusterRefusal.ts';
import { WebglClusterOwner } from './webglClusterOwner.ts';

type HostScene = ConstructorParameters<typeof ClusterBatches>[0];
type SceneCopy = NonNullable<ConstructorParameters<typeof ClusterBatches>[3]>[number] & {
  userData: { sourceGeometry?: unknown; sourceMaterial?: unknown };
};

/**
 * The batches of a prepared scene and their one draw owner. A scene the owner cannot draw in
 * full is refused by name — `refusal` fails the preparation and every draw — since nothing else
 * draws paged clusters and a partial image is not an option. Without a context there is no
 * owner: the cut still runs, the draw is refused.
 *
 * Every scene copy is the owner's and none enters the host scene: the transmissive ones compose
 * over the frozen backdrop, the blended ones draw after them, and both keep their source
 * geometry and material for the diagnostic modes to restore. `drawHostGeometry` is the
 * engine's whole draw.
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
  for (const copy of blendCopies) {
    copy.userData.sourceGeometry = copy.geometry;
    copy.userData.sourceMaterial = copy.material;
  }
  const batches = new ClusterBatches(scene, pages, owner, blendCopies);
  const drawHostGeometry = (camera: HostDrawCamera, output: HostDrawOutput) => {
    if (refusal) throw refusal;
    if (owner) owner.toneCurve = TONE_MAPPING_RANK[output.toneMapping ?? DEFAULT_TONE_MAPPING];
    batches.draw(camera, output.toneMapped, true);
  };
  return { batches, refusal, drawHostGeometry };
}
