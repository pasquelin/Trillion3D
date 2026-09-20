import type { BackendContext } from './backendTypes.ts';
import { ClusterBatches, type BatchPage } from './clusterBatches.ts';
import { clusterWebglCompatibility } from './webglClusterCompatibility.ts';

export function createExactPagesClusterBatches(
  scene: ConstructorParameters<typeof ClusterBatches>[0],
  pages: readonly BatchPage[],
  blendCopies: Array<{ material: BatchPage['material'] }>,
  context: Pick<BackendContext, 'webglContext' | 'onDiagnostic'>,
) {
  const reason = context.webglContext
    ? clusterWebglCompatibility(pages, blendCopies, scene)
    : 'engine WebGL2 context unavailable';
  if (reason)
    context.onDiagnostic?.({
      phase: 'cluster-webgl-fallback',
      message: 'Paged clusters retained the Three draw adapter',
      context: { reason },
    });
  return new ClusterBatches(scene, pages, reason ? undefined : context.webglContext);
}
