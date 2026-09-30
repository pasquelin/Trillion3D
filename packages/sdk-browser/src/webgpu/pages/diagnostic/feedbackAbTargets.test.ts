import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shadeColorAttachments } from '../prepare/attachments.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

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
