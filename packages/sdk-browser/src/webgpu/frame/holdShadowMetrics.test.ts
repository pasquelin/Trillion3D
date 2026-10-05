// What a held frame publishes of its cull and shadows: a cut page waiting for its bytes forbids
// holding, and the shadow counters keep the virtual shadow maps' public names (`holdMetrics.test.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { holdWebgpuFrame } from './hold.ts';
import { metricsOf } from '../pages/io/metrics.ts';
import { heldFrame } from './holdMetrics.fixture.ts';

test('a cut page waiting for its bytes forbids holding the frame', () => {
  const { rt, device } = heldFrame();
  const pending = rt.services.cutPending as { count: number };
  assert.equal(holdWebgpuFrame(rt, device), true, 'a fully arrived cut holds');
  // The count is the one the cut difference holds: no list is reread here.
  pending.count = 1;
  assert.equal(holdWebgpuFrame(rt, device), false, 'a pending page can still open a hole');
  assert.equal(rt.run.frameHeld, false);
  pending.count = 0;
  assert.equal(holdWebgpuFrame(rt, device), true);
});

test("the shadow counters of a frame are the virtual shadow maps', under their public names", () => {
  const { rt, timing } = heldFrame();
  const lights = rt.lights as unknown as Record<string, unknown>;
  assert.equal(metricsOf(rt).shadowVsmLights, null, 'no virtual shadow maps yet');
  lights.vsm = {
    res: { bytes: 4096 },
    countersOn: true,
    stats: {
      lights: 2,
      fullMaps: 16,
      singlePageMaps: 1,
      requestedPages: 211,
      allocatedPages: 64,
      cachedPages: 147,
      renderedPages: 6,
      freePages: 4032,
      pressureBiasStat: 0,
      projectionPasses: 2,
    },
  };
  const passes: { name: string; gpuMs: number | null }[] = [
    { name: 'vsm.markPagesFromPixels', gpuMs: 0.25 },
    { name: 'vsm.render.raster', gpuMs: 1 },
    { name: 'vsm.render.cull', gpuMs: 0.5 },
    { name: 'vsm.projection', gpuMs: null },
  ];
  timing.lastGpuPassMs = { ...timing.lastGpuPassMs, passes };
  // The stage times are named per stage (`vsmFrameMetrics`), a record the metrics type leaves open.
  const metrics = metricsOf(rt) as ReturnType<typeof metricsOf> & Record<string, number | null>;
  assert.deepEqual(
    [
      metrics.shadowVsmLights,
      metrics.shadowVsmMaps,
      metrics.shadowVsmPagesRequested,
      metrics.shadowVsmPagesAllocated,
      metrics.shadowVsmPagesCached,
      metrics.shadowVsmPagesRendered,
      metrics.shadowVsmFreePages,
      metrics.shadowVsmLodBias,
      metrics.shadowVsmProjectionPasses,
    ],
    [2, 17, 211, 64, 147, 6, 4032, 0, 2],
  );
  assert.deepEqual(
    [metrics.shadowVsmMarkingMs, metrics.shadowVsmRenderMs, metrics.shadowVsmProjectionMs],
    [0.25, 1.5, null],
    'stage times summed per stage; an untimed pass says nothing',
  );
});
