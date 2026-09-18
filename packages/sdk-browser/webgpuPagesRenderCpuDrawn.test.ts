// Lot triangles synchrones, chemin processeur (`renderCpuCut`, `webgpuPagesRenderCpu.ts`) : la coupe
// processeur dessine tout ce qu'elle a sélectionné — aucune grappe résidente ne peut y manquer, les
// vérifications de résidence la font échouer avant le dessin. `uncoveredTriangles` vaut donc toujours
// zéro sur ce chemin, et `drawnTriangles` reprend `selectedTriangles` tel quel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { camera, quadBackend } from './webgpuPagesTestScenes.ts';

test('coupe processeur (visibility buffer indisponible) : drawnTriangles = selectedTriangles, uncoveredTriangles = 0', async () => {
  installGpuGlobals();
  // `rejectR32 = true` : la cible r32uint du visbuffer échoue, le moteur retombe sur le raster de
  // page et la coupe processeur — même repli que dans webgpuPages.08.test.ts.
  const { device } = mockGpu(undefined, undefined, false, true);
  const { fixture, backend } = quadBackend(device);
  await backend.prepare();
  assert.equal(backend.capabilities.unsupported.includes('visibility buffer'), true);
  backend.render(camera());
  await backend.flush();
  backend.render(camera());
  const metrics = backend.metrics();
  assert.ok(
    (metrics.selectedTriangles ?? 0) > 0,
    'témoin : la coupe a bien sélectionné des triangles',
  );
  assert.equal(metrics.uncoveredTriangles, 0);
  assert.equal(metrics.drawnTriangles, metrics.selectedTriangles);
  backend.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
});
