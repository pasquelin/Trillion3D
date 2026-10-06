import test from 'node:test'
import assert from 'node:assert/strict'
import { createRasterBindings } from './bindings.ts'
import type { GpuRasterInput } from './types.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

test('raster variants compare their bound mask even when its selection owner stays', () => {
  const { device, bindGroups } = fakeDevice()
  const read = createRasterBindings(device, {} as GPUBindGroupLayout, {} as GPUBuffer)
  const input = {
    selection: { maskBuffer: {} },
    groups: [],
    groupKey: 0,
  } as unknown as GpuRasterInput
  const first = read(input)
  assert.equal(read(input), first)
  input.selection!.maskBuffer = {} as GPUBuffer
  assert.notEqual(read(input), first)
  input.groupKey = 1
  const second = read(input)
  input.groupKey = 0
  read(input)
  input.groupKey = 1
  assert.equal(read(input), second, 'switching a variant does not remake its unchanged group')
  assert.equal(bindGroups.length, 3)
})
