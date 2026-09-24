import type * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import type { RenderBackend } from '../../../packages/sdk-browser/src/backend/types.ts';
import {
  blendFixture,
  camera as fixtureCamera,
} from '../../../packages/sdk-browser/src/page/selection/blend.fixture.ts';
import { mountExplorerProof } from './webglClusterExplorerMount.ts';

/** `RenderBackend` does not declare `selectedPageIds` publicly; the object `exactPagesBackend`
 *  returns still carries it. Read here through a local extension rather than widening the
 *  engine's public contract. */
interface BackendAvecSelectedPageIds extends RenderBackend {
  selectedPageIds?(): string[];
}

export function execute() {
  const fixture = blendFixture(),
    camera = fixtureCamera(),
    mounted = mountExplorerProof(
      fixture,
      camera,
      (object: G.GraphNode) => object.userData.lodRole === 'exact',
    );
  if (!mounted) return { unavailable: 'WebGL2 unavailable' };
  const { backend, draw, target, calls } = mounted;
  if (!backend.setDiagnostic) throw new Error('backend missing setDiagnostic');
  const setDiagnostic = backend.setDiagnostic;
  const withSelectedIds = backend as BackendAvecSelectedPageIds;
  if (!withSelectedIds.selectedPageIds) throw new Error('backend missing selectedPageIds');

  backend.render(camera);
  draw(backend, null);
  const beautyMetrics = backend.metrics(),
    beautyDraws = beautyMetrics.autonomousClusterDrawsTotal ?? 0,
    selectedIds = withSelectedIds.selectedPageIds();
  setDiagnostic('clusters');
  backend.render(camera);
  draw(backend, null);
  const diagnosticMetrics = backend.metrics(),
    diagnosticDraws = (diagnosticMetrics.autonomousClusterDrawsTotal ?? 0) - beautyDraws;
  draw(backend, target);
  const captureDraws =
    (backend.metrics().autonomousClusterDrawsTotal ?? 0) - beautyDraws - diagnosticDraws;
  setDiagnostic('beauty');
  for (let i = 0; i < 4; i++) {
    backend.render(camera);
    draw(backend, null);
  }
  const held = backend.frameHeld === true;
  const pagedHostCalls = mounted.countedInHostPass;
  mounted.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
  return {
    beautyDraws,
    selectedIds,
    beautyCounts: [
      beautyMetrics.drawCalls,
      beautyMetrics.subDraws,
      beautyMetrics.submittedTriangles,
    ],
    diagnosticDraws,
    diagnosticCounts: [
      diagnosticMetrics.drawCalls,
      diagnosticMetrics.subDraws,
      diagnosticMetrics.submittedTriangles,
    ],
    captureDraws,
    held,
    pagedHostCalls,
    hostCalls: calls.length,
  };
}
