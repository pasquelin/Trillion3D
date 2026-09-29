// #1211: the casters the per-page cull kept and those it rejected, per sampled frame, on the public
// metrics. Each batch's culls count the casters they test into one word after its commands; the
// sample copies it after the batch's commands, and what the kept counts leave of it was rejected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STALE_REASONS } from '../../../../sdk-core/src/scene/light-shadow/counts.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { createShadowWork, shadowWorkMetrics } from '../../webgpu/shadow/work.ts';
import { SHADOW_REGION_COMMANDS, SHADOW_TESTED_WORD } from './batchBudget.ts';
import { createGpuShadowCullCounts } from './cullCounts.ts';
import { SHADOW_CULL_SHADER, SHADOW_LIGHT_CULL_SHADER } from './cullShader.ts';

test('both cull entries count the casters they test, of the kind the region draws, once a group', () => {
  for (const shader of [SHADOW_CULL_SHADER, SHADOW_LIGHT_CULL_SHADER]) {
    const counted = shader.indexOf('atomicAdd(&tested,1u);');
    assert.ok(
      counted > shader.indexOf('volume.casters!=') && counted < shader.indexOf('let sphere='),
    );
    assert.match(shader, /\n flushTested\(lane\);\n\}/);
    assert.ok(shader.includes(`atomicAdd(&indirect[${SHADOW_TESTED_WORD}u],n)`));
  }
});

test('a sampled frame publishes the casters its culls kept and those they rejected', async () => {
  let mapped!: () => void;
  const mapping = new Promise<void>((resolve) => (mapped = resolve));
  const { device, buffers } = fakeDevice({ mapping });
  const counts = createGpuShadowCullCounts(device, SHADOW_REGION_COMMANDS, SHADOW_TESTED_WORD);
  // Two batches, of two regions then one, each followed by its tested word.
  const words = new Uint32Array(2 * 8 + 1 + 8 + 1);
  [words[1], words[5], words[9], words[13], words[16]] = [5, 1, 3, 0, 40];
  [words[18], words[22], words[25]] = [2, 2, 10];
  new Uint32Array(buffers[0]!.getMappedRange()).set(words);
  const encoder = device.createCommandEncoder(),
    copies: number[][] = [];
  Object.assign(encoder, {
    copyBufferToBuffer: (_s: GPUBuffer, from: number, _d: GPUBuffer, at: number, size: number) =>
      copies.push([from, at, size]),
  });
  const indirect = {} as GPUBuffer;
  counts.sample(encoder, indirect, 2, 40);
  counts.sample(encoder, indirect, 1, 40);
  counts.submitted();
  const tested = SHADOW_TESTED_WORD * 4;
  assert.deepEqual(copies, [
    [0, 0, 64],
    [tested, 64, 4],
    [0, 68, 32],
    [tested, 100, 4],
  ]);
  mapped();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(counts.counts(), { frame: 40, regions: 3, kept: 13, moving: 0, tested: 50 });
  const metrics = shadowWorkMetrics({
    shadowWork: createShadowWork(),
    plan: { counts: { staledBy: new Int32Array(STALE_REASONS.length) } },
    cull: counts,
  });
  assert.equal(metrics.shadowMovingCastersKept, 0);
  assert.equal(metrics.shadowCastersRejected, 37);
  counts.dispose();
});
