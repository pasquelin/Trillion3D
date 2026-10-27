import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuVisibilityRasterPipelines } from './pipelines.ts'
import { createWebgpuShadePipelines } from './shadePipelines.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'

test('the visibility raster pipelines are built with every creation under a scope', async () => {
  const { device } = fakeDevice({ strictScopes: true })
  const stubs = [{} as GPUShaderModule, {} as GPUBindGroupLayout] as const
  const raster = await createWebgpuVisibilityRasterPipelines(device, ...stubs)
  assert.ok(raster.visPipelineBack && raster.visPipelineNone && raster.visPipelineFront)
})

test("the shade pipelines and their layouts are made under the build's scope", async () => {
  const { device } = fakeDevice({ strictScopes: true })
  const { shadeBindGroupLayout, shadeClasses } = await createWebgpuShadePipelines(
    device,
    {} as GPUShaderModule,
    [0],
  )
  assert.ok(shadeBindGroupLayout)
  assert.ok(shadeClasses.of(0).ready)
})
