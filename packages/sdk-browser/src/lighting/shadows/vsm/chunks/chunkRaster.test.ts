// The shadow raster's chunk pass draws one indirect command a corner tier whose arguments the GPU
// wrote — the voxel tier too on a frame whose table holds a voxel row, none here —, in a pass of
// its own between the chunk's compute passes: its commands are encoded directly, never as a render
// bundle — a bundle there would cost a key and `executeBundles` for the same commands.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createVsmResources } from '../resources.ts'
import { encodeVsmRender } from '../render/renderPass.ts'
import { recordingRaster } from '../recordingRaster.fixture.ts'
import {
  VSM_RENDER_ARGS_DRAW,
  VSM_RENDER_ARGS_STRIDE_WORDS,
  VSM_RENDER_CORNER_TIERS,
} from '../render/renderParamsWgsl.ts'

test('each chunk raster encodes two groups and a pipeline and indirect draw a tier, no bundle', () => {
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
    const tiers = Array.from({ length: VSM_RENDER_CORNER_TIERS }, (_, t) => t)
    assert.deepEqual(
      commands.map(([name]) => name),
      [
        'setBindGroup',
        'setBindGroup',
        ...tiers.flatMap(() => ['setPipeline', 'drawIndirect']),
        'end',
      ],
    )
    assert.equal(commands[0][1][1], scene.pageGroup, 'the page group at 0')
    for (const t of tiers)
      assert.equal(
        commands[3 + 2 * t][1][1],
        (c * VSM_RENDER_ARGS_STRIDE_WORDS + VSM_RENDER_ARGS_DRAW + 4 * t) * 4,
        "the chunk's own arguments of the tier",
      )
  })
  assert.equal(fake.bundles.length, 0, 'no bundle recorded')
})
