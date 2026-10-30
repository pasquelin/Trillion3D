// The sky pass opens no pass without the frame's lights' key (no transparent was prepared) nor without a sky surface in the plan.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuBlendState } from '../../blend/state.ts'
import { SKY_VIEW } from '../../blend/expand/expansionViews.ts'
import { encodeSkyPass } from './encodeSkyPass.ts'
import { skyDrawn } from './skyRoots.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

const opened: string[] = []
const encoder = {
  beginRenderPass: (descriptor: GPURenderPassDescriptor) => {
    opened.push(descriptor.label ?? '')
    throw new Error('NOT_EXPECTED')
  },
} as unknown as GPUCommandEncoder

test('no key, or no sky view in the plan: no pass is opened', () => {
  const blendState = createWebgpuBlendState()
  const rt = { blendState, gpu: {}, vis: {} } as unknown as WebgpuPagesRuntime
  encodeSkyPass(rt, {} as GPUDevice, encoder, true)
  blendState.frameViews[SKY_VIEW].active = true
  encodeSkyPass(rt, {} as GPUDevice, encoder, false)
  // The view is open but the plan has no run, no arguments and no target yet.
  encodeSkyPass(rt, {} as GPUDevice, encoder, true)
  assert.deepEqual(opened, [])
})

test('the sky pass drew nothing in an image that opened no pass', () => {
  const blendState = createWebgpuBlendState()
  const rt = { blendState, gpu: {}, vis: {} } as unknown as WebgpuPagesRuntime
  assert.equal(skyDrawn(rt), false)
  encodeSkyPass(rt, {} as GPUDevice, encoder, false)
  assert.equal(skyDrawn(rt), false)
})
