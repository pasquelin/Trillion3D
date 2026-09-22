import test from 'node:test';
import assert from 'node:assert/strict';
import { frameTargetAllocation } from './webgpuPagesTargets.ts';
import { ensureTaaTargets } from './taaPrepare.ts';
import { frameTargetBytes } from './surfaceBuffer.ts';
import { TAA_HISTORY_BYTES_PER_PIXEL } from './temporalAntialiasing.ts';
import { MEASURE_HEIGHT, MEASURE_WIDTH } from '../../test/appui/sceneProvenance.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** An engine reduced to its targets, with a dummy temporal pass that notes its resizes. */
function runtime() {
  const resized: number[][] = [],
    failures: string[] = [];
  const temporal = {
    frame: { hasHistory: true, stillFrames: 5 },
    resize(w: number, h: number) {
      resized.push([w, h]);
      return true;
    },
    dispose() {},
  };
  const rt = {
    setup: {
      gpuDevice: { limits: { maxTextureDimension2D: 8192 } },
      reserveHiz: true,
    },
    gpu: { temporal },
    capture: { capturing: false },
    capabilities: { unsupported: [] as string[] },
    diag: { diagnosticFailure: (phase: string) => failures.push(phase) },
  } as unknown as WebgpuPagesRuntime;
  return { rt, temporal, resized, failures };
}

// The defect this test catches: a 288 MiB ceiling, sampled once on this Mac, refused 4K and the
// compute raster at 2496×1404 (`SURFACE_BUDGET: 415 MB > 288 MiB`, 18 Sept. 2026) on a machine that
// held them. As in the reference, targets follow resolution: what they cost is published, and only
// a size the device cannot make is refused.
test('targets follow resolution, history included: 4K is admitted and costed', () => {
  const { rt, resized, temporal } = runtime();
  for (const [width, height] of [
    [MEASURE_WIDTH, MEASURE_HEIGHT],
    [3840, 2160],
  ]) {
    const base = frameTargetAllocation(rt, width, height);
    assert.equal(base, frameTargetBytes(width, height, true));
    assert.equal(ensureTaaTargets(rt, width, height), width * height * TAA_HISTORY_BYTES_PER_PIXEL);
  }
  assert.ok(frameTargetBytes(3840, 2160, true) > 288 * 1024 * 1024, '4K exceeds the old ceiling');
  assert.deepEqual(resized, [
    [MEASURE_WIDTH, MEASURE_HEIGHT],
    [3840, 2160],
  ]);
  // Reallocated targets no longer have history.
  assert.equal(temporal.frame.hasHistory, false);
  assert.equal(temporal.frame.stillFrames, 0);
  assert.throws(() => frameTargetAllocation(rt, 8193, 16), /SURFACE_DEVICE_LIMIT/);
});

test("a surface capture does not touch the view's history targets", () => {
  const { rt, resized } = runtime();
  rt.capture.capturing = true;
  assert.equal(ensureTaaTargets(rt, 64, 64), 0, 'the capture reserve already carries the history');
  assert.deepEqual(resized, []);
});
