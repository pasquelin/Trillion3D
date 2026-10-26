import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shadeColorAttachments } from '../../frame/prepare/attachments.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { blendTargets } from '../../blend/blendTargets.ts'

test('blend pipelines omit exactly the feedback output', () => {
  // The colour, the feedback, the two display layers' slots: no front target, the front pass writes
  // the transparents' front alone (`frontLayer.ts`), no as-is share since a debug view's as-is pixels
  // are composed after the temporal pass, and no responsiveness, which the pass of its own writes
  // (`drawResponsive`). One module serves both variants (override `FEEDBACK`): without the feedback
  // its location stays, an empty slot.
  assert.equal(blendTargets('normal', 0xf, true).length, 4)
  assert.equal(blendTargets('normal', 0xf, false).length, 4)
  assert.equal(blendTargets('normal', 0xf, true)[1]?.format, 'r32uint')
  assert.equal(blendTargets('normal', 0xf, false)[1], null)
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
