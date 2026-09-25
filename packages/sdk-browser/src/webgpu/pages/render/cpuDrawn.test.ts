// Synchronous-triangles lot, CPU path (`renderCpuCut`, `cpu.ts`): the CPU cut draws
// everything it selected — no resident cluster can be missing, residency checks make it fail before
// the draw. `drawnTriangles` therefore takes `selectedTriangles` as-is, and `uncoveredTriangles` is
// null: counters that count what is drawn cannot tell a hole.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { camera, quadBackend } from '../testScenes.fixture.ts';

test('coupe processeur (visibility buffer indisponible) : drawnTriangles = selectedTriangles, uncoveredTriangles null', async () => {
  installGpuGlobals();
  // `rejectR32 = true`: the visbuffer r32uint target fails, the engine falls back to the page raster
  // and the CPU cut — the same fallback as in ./hizOcclusion.test.ts.
  const { device } = mockGpu({ rejectR32: true });
  const { fixture, backend } = quadBackend(device);
  await backend.prepare();
  assert.equal(backend.capabilities.unsupported.includes('visibility buffer'), true);
  backend.render(camera());
  await backend.flush?.();
  backend.render(camera());
  const metrics = backend.metrics();
  assert.ok((metrics.selectedTriangles ?? 0) > 0, 'witness: the cut did select triangles');
  assert.equal(metrics.uncoveredTriangles, null);
  assert.equal(metrics.drawnTriangles, metrics.selectedTriangles);
  backend.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
});
