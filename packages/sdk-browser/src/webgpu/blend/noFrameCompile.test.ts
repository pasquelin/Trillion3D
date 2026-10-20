// No frame compiles a transparent pipeline the scene's materials and settings reach: prepare makes
// them off the frame, a mode, share or display filter that appears later starts its own compile at
// the change (`reach.ts`), and only a frame that gets there first makes the one pipeline itself.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuBlendPipelines } from './pipelines.ts'
import { createDisplayFilter } from './displayFilter.ts'
import { mountDevice } from './translucentScene.fixture.ts'
import type { BlendGpuItem } from './state.ts'

/** Counts the pipelines made by the synchronous calls a frame could reach, from now on. */
function watch(device: GPUDevice) {
  const calls = { render: 0 }
  const render = device.createRenderPipeline.bind(device)
  device.createRenderPipeline = (descriptor) => (calls.render++, render(descriptor))
  return calls
}
const settled = () => new Promise((resolve) => setImmediate(resolve))
const item = (blending: string, transmissive = false) =>
  ({ transmissive, surface: { blending } }) as BlendGpuItem

test('what the scene reaches at prepare draws with no synchronous compile', async () => {
  const mount = mountDevice()
  const items = [item('normal', true), item('multiply'), item('additive')]
  const { blendPipelines } = await createWebgpuBlendPipelines(mount.device, items, undefined, true)
  const calls = watch(mount.device)
  for (const mode of [0, 1, 3]) {
    for (const cull of [0, 1, 2]) {
      assert.ok(blendPipelines.at(mode * 3 + cull, false, 0))
      assert.ok(blendPipelines.at(mode * 3 + cull, true, 0), 'a filtering scene: routed')
    }
  }
  for (const cull of [0, 1, 2]) assert.ok(blendPipelines.mask.at(cull))
  assert.ok(createDisplayFilter(mount.device, 4, 4))
  assert.equal(calls.render, 0)
})

test('a mode, a share or a filter reached later compiles off the frame, at the change', async () => {
  const mount = mountDevice()
  const { blendPipelines } = await createWebgpuBlendPipelines(mount.device, [item('normal')])
  const calls = watch(mount.device)
  const before = mount.renderPipelines.length
  blendPipelines.reach({ modes: ['multiply'], share: 2, filtered: true })
  await settled()
  assert.ok(mount.renderPipelines.length > before, 'the change started its compiles')
  const made = mount.renderPipelines.length
  for (const cull of [0, 1, 2]) {
    assert.ok(blendPipelines.at(9 + cull, false, 0))
    assert.ok(blendPipelines.at(9 + cull, false, 2))
    assert.ok(blendPipelines.at(9 + cull, true, 2))
    assert.ok(blendPipelines.mask.at(cull))
  }
  assert.equal(calls.render, 0, 'no frame made one')
  assert.equal(mount.renderPipelines.length, made, 'nothing compiled twice')
})

test('a frame that gets there before the compile makes the one pipeline, never a missing one', async () => {
  const mount = mountDevice()
  const { blendPipelines } = await createWebgpuBlendPipelines(mount.device, [item('normal')])
  const calls = watch(mount.device)
  const before = mount.renderPipelines.length
  assert.ok(blendPipelines.at(9 + 2, false, 0), 'multiply, never reached: made at once')
  assert.equal(calls.render, 1, 'the one cull drawn, alone')
  // Its two other culls compile off the thread from that draw on, once: a later draw of either
  // finds it made.
  await settled()
  assert.equal(mount.renderPipelines.length, before + 3)
  assert.ok(blendPipelines.at(9, false, 0) && blendPipelines.at(9 + 1, false, 0))
  assert.equal(blendPipelines.at(9 + 2, false, 0), blendPipelines.at(9 + 2, false, 0))
  assert.equal(calls.render, 1, 'once')
  assert.equal(mount.renderPipelines.length, before + 3, 'nothing compiled twice')
})
