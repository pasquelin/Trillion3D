import { bytesOf } from './globals.ts'
import { fakeDevice } from './fakeDevice.ts'
import { BACKEND, type FakeDeviceOptions } from './fakeRecords.ts'
import type { MapFaults } from './mockBuffers.ts'

/**
 * `fakeDevice(BACKEND)` read as the backend device was before the kit held one device: its writes
 * as `{ offset, bytes, label, size, seq }` — `size` the buffer's —, and each copy's destination
 * usage. A thin view for the tests of the DAG and the placements alone, until they read
 * `fakeDevice` themselves; nothing else uses it.
 */
export function mockGpu({ mapGate, ...options }: FakeDeviceOptions & MapFaults = {}) {
  const gpu = fakeDevice({ ...BACKEND, mapping: mapGate, ...options })
  return {
    ...gpu,
    get writes() {
      return gpu.writes.map(({ buffer, offset, data, dataOffset, size, seq }) => ({
        offset,
        bytes: bytesOf(data as GPUAllowSharedBufferSource, dataOffset, size).slice(),
        label: buffer.label,
        size: buffer.size,
        seq,
      }))
    },
    get copyUsages() {
      return gpu.copies.map(({ to }) => to.usage)
    },
  }
}
