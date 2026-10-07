// A transparent surface lying exactly on an opaque face draws over it: the transparent passes draw
// one coplanar layer over the opaque depth (`TRANSPARENT_DEPTH_LAYER`), as the opaque layers do —
// the blend, its display mask and the water stage alike, every cull —, and the occlusion test of
// transparent clusters lifts their depth bound by at least that layer, never rejecting a glass its
// own draw would show. The image is proven on Dawn (`tests/gpu/blend/coplanar-layers.gpu.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import {
  DEPTH_LAYER_BIAS_UNITS,
  TRANSPARENT_DEPTH_LAYER,
  depthLayerUnits,
} from '../../../../sdk-core/src/index.ts'
import { DEPTH_COMPARE } from '../../camera/depthConvention.ts'
import { transparentOcclusionShader } from '../../gpu/core/transparentOcclusionWgsl.ts'
import { stageDescriptors } from './stagePipelines.ts'

test('the transparent passes draw one coplanar layer over the opaque depth, every cull', () => {
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
    )
    assert.equal(stages.length, 3)
    for (const { depthStencil, primitive } of stages) {
      assert.equal(primitive?.topology, 'triangle-list', 'a depth bias wants triangles')
      assert.equal(depthStencil?.depthCompare, DEPTH_COMPARE)
      assert.equal(depthStencil?.depthWriteEnabled, depthWrite)
      assert.equal(depthStencil?.depthBias, depthLayerUnits(TRANSPARENT_DEPTH_LAYER))
    }
  }
  assert.equal(depthLayerUnits(TRANSPARENT_DEPTH_LAYER), DEPTH_LAYER_BIAS_UNITS, 'one layer step')
})

test('the transparent occlusion test lifts its bound by at least the transparent layer', () => {
  assert.ok(
    transparentOcclusionShader(4).includes(
      `projectBox(i,max(uni.layerTop,${TRANSPARENT_DEPTH_LAYER}u))`,
    ),
  )
})
