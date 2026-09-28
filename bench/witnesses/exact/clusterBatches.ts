import {
  DEFAULT_TONE_MAPPING,
  TONE_MAPPING_RANK,
} from '../../../packages/sdk-core/src/scene/core/environment.ts';
import type {
  BackendContext,
  HostDrawOutput,
} from '../../../packages/sdk-browser/src/backend/types.ts';
import type { HostDrawCamera } from '../../../packages/sdk-browser/src/camera/world.ts';
import { ClusterBatches, type BatchPage } from './batches/batches.ts';
import { clusterWebglCompatibility } from '../../../packages/sdk-browser/src/webgl/cluster/compatibility.ts';
import { clusterRefusal } from '../../../packages/sdk-browser/src/webgl/cluster/refusal.ts';
import { WebglClusterOwner } from '../../../packages/sdk-browser/src/webgl/cluster/owner.ts';
import { degradedHearer } from '../../../packages/sdk-browser/src/world/diagnostic/materialNotices.ts';

type HostScene = ConstructorParameters<typeof ClusterBatches>[0];
type SceneCopy = NonNullable<ConstructorParameters<typeof ClusterBatches>[3]>[number] & {
  userData: Record<string, unknown>;
};

/**
 * The batches of a prepared scene and their one draw owner. A scene the owner cannot draw in
 * full is refused by name — `refusal` fails the preparation and every draw — since nothing else
 * draws paged clusters and a partial image is not an option; a physical feature WebGL2 cannot
 * draw is no refusal, the surface is drawn without it and `materialDegraded` hears it. Without a
 * context there is no owner: the cut still runs, the draw is refused.
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
  context: Pick<BackendContext, 'webglContext' | 'materialDegraded' | 'onDiagnostic'>,
) {
  const gl = context.webglContext;
  const reason = gl && clusterWebglCompatibility(gl, pages, blendCopies, scene);
  const refusal = reason ? clusterRefusal(reason) : undefined;
  const owner = gl && !refusal ? new WebglClusterOwner(gl, degradedHearer(context)) : undefined;
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
