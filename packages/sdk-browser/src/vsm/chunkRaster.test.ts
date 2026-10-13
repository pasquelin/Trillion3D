// The shadow raster's chunk pass draws one indirect command whose arguments the GPU wrote, in a pass
// of its own between the chunk's compute passes: its four commands are encoded directly, never as a
// render bundle — a bundle there would cost a key and `executeBundles` for the same four commands.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createVsmResources } from './resources.ts'
import { encodeVsmRender } from './renderPass.ts'
import { recordingRaster } from './recordingRaster.fixture.ts'
import { VSM_RENDER_ARGS_DRAW, VSM_RENDER_ARGS_STRIDE_WORDS } from './renderCullWgsl.ts'

test('each chunk raster encodes its pipeline, two groups and its indirect draw, no bundle', () => {
  const fake = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 27, maxBufferSize: 1 << 27 },
  })
  const { device } = fake
  const res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 })
  const { encoder, scene, lights } = recordingRaster(device, 100)
  const { chunks } = encodeVsmRender(encoder, res, { device, lights }, scene)!
  assert.ok(chunks > 0)
  const chunkRasters = fake.passes.filter(({ label }) => /\.raster \d+$/.test(label ?? ''))
  assert.equal(chunkRasters.length, chunks, 'one raster pass a chunk')
  chunkRasters.forEach(({ commands }, c) => {
    assert.deepEqual(
      commands.map(([name]) => name),
      ['setPipeline', 'setBindGroup', 'setBindGroup', 'drawIndirect', 'end'],
    )
    assert.equal(commands[1][1][1], scene.pageGroup, 'the page group at 0')
    assert.equal(
      commands[3][1][1],
      c * VSM_RENDER_ARGS_STRIDE_WORDS * 4 + VSM_RENDER_ARGS_DRAW * 4,
      "the chunk's own arguments",
    )
  })
  assert.equal(fake.bundles.length, 0, 'no bundle recorded')
})
