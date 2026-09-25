import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../../../../../tests/kit/gpu/timingDevice.ts';
import { createGpuTiming } from './timing.ts';
import { QUERY_COUNT, SHADOW_BATCH_PASSES, TIMED_PASSES } from './queries.ts';
import { MAX_SHADOW_BATCHES } from '../shadow/batchBudget.ts';
import { DAG_MAX_VIEWS } from '../dag/shader/viewsWgsl.ts';
import { LIGHT_CUT_PASS } from '../dag/encode.ts';
import { SHADOW_PASS } from '../shadow/atlas.ts';
import { SHADOW_LAYER_PASS } from '../shadow/staticLayer.ts';
import { SHADOW_TRANSMITTANCE_PASS } from '../shadow/transmittance.ts';
import { directLightTimings } from '../../stage/mapping.ts';

// A frame draws every shadow page it marks, in as many batches as that takes (#489): the frame that
// redraws the largest pool is timed whole — every batch's passes, the CPU cut's cull per face
// included —, so its shadow milliseconds and their cull and raster split are published (#525).
test('a frame of the most shadow batches is timed whole, its cull and raster split kept', async () => {
  const f = fixture(),
    samples: any[] = [];
  const timer = createGpuTiming(f.device, { onSample: (sample) => void samples.push(sample) });
  const selection = timer.createEncoder(1);
  selection.beginComputePass({ label: 'selection' }).end();
  selection.finish();
  const frame = timer.createEncoder(1);
  const pass = (label: string) => frame.beginComputePass({ label }).end();
  for (let batch = 0; batch < MAX_SHADOW_BATCHES; batch++) {
    for (let k = 0; k < 3; k++) pass(LIGHT_CUT_PASS);
    for (let face = 0; face < DAG_MAX_VIEWS; face++) pass('Trillion3D shadow cull');
    pass(SHADOW_LAYER_PASS);
    pass('Trillion3D shadow page pyramids');
    pass('Trillion3D shadow occlusion');
    pass(SHADOW_PASS);
    pass(SHADOW_TRANSMITTANCE_PASS);
  }
  for (let k = 0; k < 200; k++) pass('lighting');
  frame.finish();
  const values = new BigUint64Array(f.buffers[1].getMappedRange());
  for (let k = 0; k < QUERY_COUNT; k++) values[k] = BigInt(k + 1) * 1000n;
  timer.submitted(frame, { frame: 1 });
  await timer.flush();
  const [sample] = samples;
  assert.equal(sample.truncated, false, 'every pass timed');
  assert.equal(sample.passes.length, 1 + MAX_SHADOW_BATCHES * SHADOW_BATCH_PASSES + 200);
  assert.ok(sample.passes.length <= TIMED_PASSES);
  const { gpuShadowsMs, gpuShadowCullMs, gpuShadowRasterMs } = directLightTimings(sample);
  assert.ok(gpuShadowsMs !== null && gpuShadowCullMs !== null && gpuShadowRasterMs !== null);
  timer.dispose();
});
