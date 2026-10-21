import test from 'node:test'
import assert from 'node:assert/strict'
import { createRasterBindings } from './bindings.ts'
import type { GpuRasterInput } from './types.ts'
import { RASTER_PASS_MAIN, RASTER_PASS_POST } from './contract.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'

test('the binning compares its bound mask even when its selection owner stays', () => {
  const { device, bindGroups } = fakeDevice()
  const layout = {} as GPUBindGroupLayout
  const { bin } = createRasterBindings(device, { raster: layout, bin: layout }, {} as GPUBuffer)
  const input = { selection: { maskBuffer: {} } } as unknown as GpuRasterInput
  const first = bin(input, RASTER_PASS_MAIN)
  assert.equal(bin(input, RASTER_PASS_MAIN), first)
  input.selection!.maskBuffer = {} as GPUBuffer
  assert.notEqual(bin(input, RASTER_PASS_MAIN), first)
  const second = bin(input, RASTER_PASS_POST)
  bin(input, RASTER_PASS_MAIN)
  assert.equal(bin(input, RASTER_PASS_POST), second, 'switching a pass does not remake its group')
  // The hardware raster's group, made with the bindings, then the binning's three.
  assert.equal(bindGroups.length, 4)
})
