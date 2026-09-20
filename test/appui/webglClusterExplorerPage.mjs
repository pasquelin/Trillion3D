import * as THREE from 'three';
import { exactPagesBackend } from '../../packages/sdk-browser/exactPagesBackend.ts';
import { createSceneDrawer } from '../../packages/sdk-browser/explorerDrawScene.ts';
import {
  blendFixture,
  camera as fixtureCamera,
} from '../../packages/sdk-browser/pageSelectionBlendFixture.ts';

export function execute() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const gl = canvas.getContext('webgl2');
  if (!gl) return { unavailable: 'WebGL2 unavailable' };
  const host = new THREE.WebGLRenderer({ canvas, context: gl }),
    fixture = blendFixture(),
    backend = exactPagesBackend({
      source: fixture.source,
      metadata: fixture.metadata,
      indices: fixture.indices,
      associations: fixture.associations,
      pixelError: 0,
      viewport: [64, 64],
      webglContext: gl,
    }),
    camera = fixtureCamera(),
    draw = createSceneDrawer(host, camera),
    target = new THREE.WebGLRenderTarget(64, 64),
    calls = [];
  const originalRender = host.render.bind(host);
  host.render = (scene, view) => {
    let paged = 0;
    scene.traverse((object) => {
      if (object.userData.lodRole === 'exact') paged++;
    });
    calls.push({ paged, children: scene.children.length });
    return originalRender(scene, view);
  };

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
  const pagedHostCalls = calls.reduce((sum, call) => sum + call.paged, 0);
  draw.dispose();
  backend.dispose();
  target.dispose();
  host.dispose();
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
