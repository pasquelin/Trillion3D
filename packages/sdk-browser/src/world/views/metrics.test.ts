import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewMetrics } from './metrics.ts';
import type { RenderBackend } from '../../backend/types.ts';
import type { FrameMetrics } from '../../../../sdk-core/src/index.ts';

test('frame counts combine cameras, shared bytes stay single, and an unmeasured camera stays unknown', () => {
  const frame = createViewMetrics();
  const backend = (drawCalls: number, triangles: number | null, ready: boolean) =>
    ({
      frameHeld: ready,
      metrics: () => ({ drawCalls, totalSubmittedTriangles: triangles, coverageReady: ready }),
    }) as unknown as RenderBackend;
  const into = { geometryAllocationBytes: 1024, gpuFrameMs: 3, gpuShadowsMs: 1 } as FrameMetrics;
  frame.add(backend(2, 100, true));
  frame.add(backend(5, null, false));
  frame.publish(into);
  assert.equal(into.drawCalls, 7);
  assert.equal(
    into.totalSubmittedTriangles,
    null,
    'the missing measurement is not reported as zero',
  );
  assert.equal(
    into.geometryAllocationBytes,
    1024,
    'shared pools are not multiplied by camera count',
  );
  assert.equal(into.coverageReady, false);
  assert.equal(into.frameHeld, false);
  assert.equal(into.gpuFrameMs, null);
  assert.equal(into.gpuShadowsMs, null, 'the last view’s timestamp cannot represent all cameras');
  frame.reset();
  frame.add(backend(1, 20, true));
  const single = { drawCalls: 42, gpuFrameMs: 4 } as FrameMetrics;
  frame.publish(single);
  assert.deepEqual(
    single,
    { drawCalls: 42, gpuFrameMs: 4 },
    'the existing single-view metrics path is unchanged',
  );
});
