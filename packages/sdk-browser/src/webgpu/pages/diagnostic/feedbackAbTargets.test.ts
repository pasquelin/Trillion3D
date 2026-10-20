import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shadeColorAttachments } from '../prepare/attachments.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { shadeTargetFormats } from '../../visibility/shadeTargets.ts'
import { blendTargets } from '../../blend/blendTargets.ts'

test('opaque and blend pipelines omit exactly the feedback output', () => {
  assert.equal(shadeTargetFormats(true).length, 5)
  assert.equal(shadeTargetFormats(false).length, 4)
  assert.equal(shadeTargetFormats(true)[4], 'r32uint')
  // The colour, the feedback, the share, the two display layers' slots: no front target, the front
  // pass writes the transparents' front alone (`frontLayer.ts`). One module serves both variants
  // (override `FEEDBACK`): without the feedback its location stays, an empty slot.
  assert.equal(blendTargets('normal', 0xf, true).length, 5)
  assert.equal(blendTargets('normal', 0xf, false).length, 5)
  assert.equal(blendTargets('normal', 0xf, true)[1]?.format, 'r32uint')
  assert.equal(blendTargets('normal', 0xf, false)[1], null)
  assert.equal(blendTargets('normal', 0xf, true)[2]?.format, 'rg8unorm')
  assert.equal(blendTargets('normal', 0xf, false)[2]?.format, 'rg8unorm')
  for (const mode of ['normal', 'additive', 'subtractive', 'multiply', 'none'] as const) {
    const share = blendTargets(mode, 0xf, true)[2]
    assert.equal(share?.blend?.color.dstFactor, 'one-minus-src-alpha')
  }
})

test('opaque attachments follow the pipelines in place and do not mark feedback written', () => {
  const views = Array.from({ length: 4 }, (_, i) => ({
    name: `surface-${i}`,
  })) as unknown as GPUTextureView[]
  const surfaces = { views: () => views } as Parameters<typeof shadeColorAttachments>[1]
  const rt = {
    vis: { writesFeedback: false },
    gpu: { feedbackView: { name: 'feedback' } },
    run: { feedbackWritten: false },
  } as unknown as WebgpuPagesRuntime
  assert.equal(shadeColorAttachments(rt, surfaces).length, 4)
  assert.equal(rt.run.feedbackWritten, false)
  rt.vis.writesFeedback = true
  assert.equal(shadeColorAttachments(rt, surfaces).length, 5)
  assert.equal(rt.run.feedbackWritten, true)
})
