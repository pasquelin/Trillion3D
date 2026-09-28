import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shadeTargetFormats } from '../../visibility/pipelines.ts';
import { blendTargets } from '../../blend/pipelines.ts';
import { waterSurfaceTargets } from '../../water/pipelines.ts';
import { shadeColorAttachments } from '../prepare/attachments.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

test('opaque, blend and water pipelines omit exactly the feedback output', () => {
  assert.equal(shadeTargetFormats(true).length, 5);
  assert.equal(shadeTargetFormats(false).length, 4);
  assert.equal(shadeTargetFormats(true)[4], 'r32uint');
  assert.equal(blendTargets('normal', 0xf, true).length, 2);
  assert.equal(blendTargets('normal', 0xf, false).length, 1);
  assert.equal(waterSurfaceTargets(true).length, 5);
  assert.equal(waterSurfaceTargets(false).length, 4);
  assert.equal(waterSurfaceTargets(true)[4].format, 'r32uint');
});

test('opaque attachments follow the target-free pipeline and do not mark feedback written', () => {
  const views = Array.from({ length: 4 }, (_, i) => ({
    name: `surface-${i}`,
  })) as unknown as GPUTextureView[];
  const surfaces = { views: () => views } as Parameters<typeof shadeColorAttachments>[1];
  const rt = {
    feedbackAB: { target: false },
    gpu: { feedbackView: { name: 'feedback' } },
    run: { feedbackWritten: false },
  } as unknown as WebgpuPagesRuntime;
  assert.equal(shadeColorAttachments(rt, surfaces).length, 4);
  assert.equal(rt.run.feedbackWritten, false);
  rt.feedbackAB!.target = true;
  assert.equal(shadeColorAttachments(rt, surfaces).length, 5);
  assert.equal(rt.run.feedbackWritten, true);
});
