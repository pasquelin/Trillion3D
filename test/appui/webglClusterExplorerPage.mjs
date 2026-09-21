import {
  blendFixture,
  camera as fixtureCamera,
} from '../../packages/sdk-browser/pageSelectionBlendFixture.ts';
import { mountExplorerProof } from './webglClusterExplorerMount.mjs';

export function execute() {
  const fixture = blendFixture(),
    camera = fixtureCamera(),
    mounted = mountExplorerProof(fixture, camera, (object) => object.userData.lodRole === 'exact');
  if (!mounted) return { unavailable: 'WebGL2 unavailable' };
  const { backend, draw, target, calls } = mounted;

  backend.render(camera);
  draw(backend, null);
  const beautyMetrics = backend.metrics(),
    beautyDraws = beautyMetrics.autonomousClusterDrawsTotal,
    selectedIds = backend.selectedPageIds();
  backend.setDiagnostic('clusters');
  backend.render(camera);
  draw(backend, null);
  const diagnosticMetrics = backend.metrics(),
    diagnosticDraws = diagnosticMetrics.autonomousClusterDrawsTotal - beautyDraws;
  draw(backend, target);
  const captureDraws =
    backend.metrics().autonomousClusterDrawsTotal - beautyDraws - diagnosticDraws;
  backend.setDiagnostic('beauty');
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
