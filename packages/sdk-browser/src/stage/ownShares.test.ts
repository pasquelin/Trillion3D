import test from 'node:test';
import assert from 'node:assert/strict';
import { addGpuPasses, directLightTimings } from './mapping.ts';
import { DEFERRED_LIGHTING_PASS } from './passLabels.ts';
import { referenceDirectLightTimings } from '../../../../bench/oracles/browser/stage-profile.ts';
import { summarizeTimestamps } from '../gpu/timing/sample.ts';
import { gpuPassBlockTotals } from '../gpu/core/passBlocks.ts';
import { vsmFrameMetrics } from '../webgpu/pages/render/vsm/vsmStats.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';

// A tiled GPU reports each pass's whole span, and spans overlap: the transmission's three passes
// each span most of a 36 ms image (a device clock never reads zero: the image begins at 1 ms).
// Every total reads the passes' own shares, so no stage, shadow stage or block passes the image,
// and the stages together are the image.
test('overlapping spans count once: no stage, shadow stage or block total passes the image', () => {
  const ms = (value: number) => BigInt(value * 1e6);
  const timed: [string, number, number][] = [
    ['vsm.render.cull 0', 1, 9],
    ['vsm.transmission.clear', 3, 31],
    ['vsm.transmission.bin', 5, 34],
    ['vsm.transmission.resolve', 7, 35],
    [DEFERRED_LIGHTING_PASS, 6, 37],
  ];
  const entries = timed.map(([name], i) => ({ slot: i * 2, name, part: 0 }));
  const values = new BigUint64Array(timed.flatMap(([, begin, end]) => [ms(begin), ms(end)]));
  const s = { frame: 1, ...summarizeTimestamps(entries, values, false, () => false).sample };
  const image = s.frameMs!;
  assert.equal(image, 36);
  const spans = s.passes.reduce((sum, pass) => sum + pass.gpuMs!, 0);
  assert.ok(spans > 3 * image, `the spans overlap: ${spans} ms added up`);
  const rt = { lights: { memory: { bias: 0 } } } as unknown as WebgpuPagesRuntime;
  const shadows = vsmFrameMetrics(rt, s);
  assert.equal(shadows.shadowVsmTransmissionMs, 26, 'what the transmission adds past the cull');
  const stages: [string, number][] = [];
  addGpuPasses(s, (stage, total) => void stages.push([stage, total]));
  const blocks = gpuPassBlockTotals(s),
    sum = (values: (number | null)[]) => values.reduce<number>((a, b) => a + (b ?? 0), 0);
  for (const [stage, total] of [
    ...Object.entries(shadows).filter(([key]) => /^shadowVsm\w+Ms$/.test(key)),
    ...stages,
    ...Object.entries(blocks),
  ] as [string, number | null][])
    assert.ok((total ?? 0) <= image, `${stage}: ${total} ms within the ${image} ms image`);
  assert.equal(sum(stages.map(([, total]) => total)), image, 'the stages are the image');
  assert.equal(sum(Object.values(blocks)), image, 'the blocks are the image');
  assert.equal(directLightTimings(s).gpuShadowsMs, 34, 'the shadow passes, an overlap once');
  assert.deepEqual(referenceDirectLightTimings(s), directLightTimings(s));
});
