// The transparent passes take one translucent depth state — tested near or equal, no bias —,
// every stage and cull, and the occlusion test of transparent clusters lifts their depth bound by
// at least the transparent layer, never rejecting a glass its own draw would show.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { TRANSPARENT_DEPTH_LAYER } from '../../../../sdk-core/src/lod/depthLayer.ts'
import { DEPTH_COMPARE_OR_EQUAL } from '../../camera/depthConvention.ts'
import { transparentOcclusionShader } from '../../gpu/core/transparentOcclusionWgsl.ts'
import { stageDescriptors } from './stagePipelines.ts'

test('the transparent passes test near or equal with no bias, every cull', () => {
  const { device } = fakeDevice()
  const module = device.createShaderModule({ code: '' })
  const layout = device.createBindGroupLayout({ entries: [] })
  for (const depthWrite of [false, true]) {
    const stages = stageDescriptors(
      device,
      module,
      layout,
      { module, entryPoint: 'fs', targets: [] },
      depthWrite,
      [],
    )
    assert.equal(stages.length, 3)
    for (const { depthStencil, primitive } of stages) {
      assert.equal(primitive?.topology, 'triangle-list')
      assert.equal(depthStencil?.depthCompare, DEPTH_COMPARE_OR_EQUAL)
      assert.equal(depthStencil?.depthWriteEnabled, depthWrite)
      assert.equal(depthStencil?.depthBias, undefined)
    }
  }
})

test('the transparent occlusion test lifts its bound by at least the transparent layer', () => {
  assert.ok(
    transparentOcclusionShader().includes(
      `projectBox(i,max(uni.layerTop,${TRANSPARENT_DEPTH_LAYER}u))`,
    ),
  )
})
