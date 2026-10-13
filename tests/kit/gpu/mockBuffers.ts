import type { FakeBuffer } from './fakeRecords.ts'
import { untag } from './fakeWebgpuDevice.ts'

/** The 32-bit words of `bytes`, where they sit in their buffer. */
export const words = (bytes: Uint8Array) =>
  new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)

/** The 32-bit floats of `bytes`, where they sit in their buffer. */
export const floats = (bytes: Uint8Array) =>
  new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)

/** What a mapping meets on the backend device (`mockGpu`, until its last readers move to
 *  `fakeDevice`): a refusal, or a gate the test opens when it chooses. */
export type MapFaults = { failMap?: boolean; mapGate?: Promise<void> }

/**
 * The buffers of `fakeDevice()`, which map as on a real device: their bytes are the mapped range;
 * mapping a destroyed buffer is a validation error on the device (`OperationError`, counted by
 * `destroyedMaps`); a mapping the destruction cuts short rejects with `AbortError`; unmapping does
 * nothing. Every mapping settles with `mapping`; `failMap` refuses every one but the explicit
 * capture's. A destroyed buffer is the one `destroyed` lists.
 */
export function fakeBuffers(
  destroyed: Array<{ label?: string }>,
  { mapping, failMap = false }: { mapping?: Promise<void>; failMap?: boolean },
) {
  const buffers: FakeBuffer[] = []
  let destroyedMaps = 0
  const gone = (buffer: FakeBuffer) => destroyed.includes(buffer)
  const createBuffer = ({ size, usage, label }: GPUBufferDescriptor) => {
    const buffer: FakeBuffer = {
      label: untag(label),
      size,
      usage,
      data: new Uint8Array(size),
      destroy: () => void destroyed.push(buffer),
      mapAsync: async () => {
        if (gone(buffer)) {
          destroyedMaps++
          throw new DOMException('destroyed', 'OperationError')
        }
        if (failMap && buffer.label !== 'Trillion3D explicit capture') throw new Error('MAP_FAILED')
        await mapping
        if (gone(buffer)) throw new DOMException('destroyed while mapping', 'AbortError')
      },
      getMappedRange: () => buffer.data.buffer as ArrayBuffer,
      unmap() {},
    }
    buffers.push(buffer)
    return buffer
  }
  return { buffers, createBuffer, destroyedMaps: () => destroyedMaps }
}
