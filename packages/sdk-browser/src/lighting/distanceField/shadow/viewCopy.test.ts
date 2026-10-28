import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../../tests/kit/fakeDevice/globals.ts'
import { ensureDfshView } from './view.ts'

installGpuGlobals()

test("the lists of a sun's cascade can be copied out: the cards' direct light reads copies of them", () => {
  const { device } = fakeDevice()
  const { view } = ensureDfshView(undefined, device, {
    extent: [1, 1],
    view: [1, 1],
    objects: 4,
    tiles: 4,
    perTile: 8,
    layers: 1,
    fullResolution: false,
  })
  assert.ok(view)
  const encoder = device.createCommandEncoder()
  // A copy from a buffer that lacks COPY_SRC is refused as the device refuses it.
  for (const buffer of [view.tileOffsets, view.tileCounts, view.tileData])
    encoder.copyBufferToBuffer(
      buffer,
      0,
      device.createBuffer({ size: 64, usage: GPUBufferUsage.COPY_DST }),
      0,
      16,
    )
})
