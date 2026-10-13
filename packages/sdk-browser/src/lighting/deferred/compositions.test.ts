// The composition takes the chain's last bloom blend over. Its programs compile at the first
// frame that asks, off the frame, and a composition handed a blend binds it as group 1 at its
// dynamic offset, with the pipelines that read it; without one, nothing changes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeferredLighting } from './deferred.ts'
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { commandArgs } from '../../../../../tests/kit/gpu/fakeRenderPass.ts'

test('a composition handed a bloom blend reads it through the bloom pipelines', async () => {
  const gpu = fakeDevice(),
    { device, renderPipelines } = gpu
  const encoder = device.createCommandEncoder()
  const view = () => ({}) as GPUTextureView
  const views = [view(), view(), view(), view()]
  const lighting = await createDeferredLighting(device)
  lighting.bind({ views: () => views } as unknown as SurfaceBuffer, view(), view(), false)
  const compiled = renderPipelines.length,
    failures: unknown[] = []
  assert.equal(
    lighting.composesBloom((error) => failures.push(error)),
    false,
    'compiling',
  )
  await new Promise((resolve) => setTimeout(resolve))
  assert.equal(renderPipelines.length, compiled + 6, 'three inputs, capture and present')
  assert.equal(
    lighting.composesBloom((error) => failures.push(error)),
    true,
  )
  const image = { color: view(), share: view() },
    blend = { group: {} as GPUBindGroup, offset: 11 * 256 }
  lighting.compose(encoder, view(), [0, 0, 0, 1], undefined, { ...image, bloom: blend })
  lighting.compose(encoder, view(), [0, 0, 0, 1], undefined, image)
  // Each pass's pipeline and the groups it set, each as its arguments.
  const passes = gpu.passes.map(({ commands }) => ({
    pipeline: commandArgs(commands, 'setPipeline')[0][0] as GPURenderPipelineDescriptor,
    groups: commandArgs(commands, 'setBindGroup'),
  }))
  assert.deepEqual(
    passes.map(({ pipeline }) => pipeline.fragment!.module.label),
    ['UNLIT_COMPOSE_BLOOM_ACCUMULATED', 'UNLIT_COMPOSE_ACCUMULATED'],
  )
  assert.deepEqual(passes[0].groups[1], [1, blend.group, [blend.offset]])
  assert.equal(passes[1].groups.length, 1, 'no blend, no second group')
  assert.equal(passes[0].groups[0][1], passes[1].groups[0][1], 'one group per image read')
  assert.deepEqual(failures, [])
  lighting.dispose()
})
