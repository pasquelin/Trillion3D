import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shadeColorAttachments } from '../../frame/prepare/attachments.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { blendTargets } from '../../blend/blendTargets.ts'

test('blend pipelines omit exactly the feedback output', () => {
  // The colour, the feedback, the share, the two display layers' slots, the history given up: no
  // front target, the front pass writes the transparents' front alone (`frontLayer.ts`). One module
  // serves both variants (override `FEEDBACK`): without the feedback its location stays, an empty slot.
  assert.equal(blendTargets('normal', 0xf, true).length, 6)
  assert.equal(blendTargets('normal', 0xf, false).length, 6)
  // The history given up at share-target key 2 alone: a slot left empty below it.
  assert.equal(blendTargets('normal', 0xf, true, false, 2)[5]?.format, 'r8unorm')
  assert.equal(blendTargets('normal', 0xf, true, false, 1)[5], null)
  assert.equal(blendTargets('normal', 0xf, true, false, 1)[2]?.format, 'rg8unorm')
  assert.equal(blendTargets('normal', 0xf, true, false, 0)[2], null)
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
