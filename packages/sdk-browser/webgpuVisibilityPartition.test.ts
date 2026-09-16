import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionWebgpuVisibility } from './webgpuVisibilityPartition.ts';
import { createWebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';
import { cameraMoteur } from './cameraFixture.ts';

test('history projection is inside the measured interval and never subtracted from an earlier endpoint', (t) => {
  const fixture = quadScene();
  const rt = createWebgpuPagesRuntime({ ...fixture, viewport: [32, 32] });
  rt.layout.rows.packedCount = 2;
  rt.layout.rows.packedPageIndex.set([0, 1]);
  rt.layout.urlIndexOfPage.set([0, 1]);
  rt.layout.drawnOccluderUrls[0] = 1;
  rt.run.noOccluderHistory = false;
  rt.vis.gpuHiz = {} as NonNullable<typeof rt.vis.gpuHiz>;
  rt.vis.visHizRestBack = {} as GPURenderPipeline;
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  t.mock.method(rt.layout.hizProjection, 'select', () => {
    clock += 7;
    return false;
  });
  const result = partitionWebgpuVisibility(rt, cameraMoteur(camera()));
  assert.equal(result.twoPass, true);
  assert.equal(rt.timing.lastProjectMs, 7);
  assert.equal(
    rt.timing.lastPartitionMs,
    0,
    'seven milliseconds of projection are not negative partition work',
  );
  assert.equal(rt.timing.lastProjectMs + rt.timing.lastPartitionMs, clock);
  fixture.geometry.dispose();
  fixture.material.dispose();
});
