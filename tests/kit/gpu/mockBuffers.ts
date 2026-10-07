/** The 32-bit words of `bytes`, where they sit in their buffer. */
export const words = (bytes: Uint8Array) =>
  new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)

/** The 32-bit floats of `bytes`, where they sit in their buffer. */
export const floats = (bytes: Uint8Array) =>
  new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)

/** What a mock buffer's mapping meets: a refusal, or a gate the test opens when it chooses. */
export type MapFaults = { failMap?: boolean; mapGate?: Promise<void> }

/** One `queue.writeBuffer` as the device double saw it, `seq` its rank among writes and submits. */
export type MockWrite = {
  offset: number
  bytes: Uint8Array
  label?: string
  size?: number
  seq: number
}

type MockBuffer = {
  label?: string
  size: number
  usage: number
  data: Uint8Array
  destroyed: boolean
}

/**
 * Buffers that map as on a real device: mapping a destroyed buffer is a validation error on the
 * device (`OperationError`, counted by `destroyedMaps`); a mapping the destruction cuts short
 * rejects with `AbortError`; unmapping does nothing. `failMap` refuses every mapping but the
 * explicit capture's.
 */
export function mockBuffers({ failMap = false, mapGate }: MapFaults) {
  const buffers: MockBuffer[] = []
  let destroyedMaps = 0
  const createBuffer = ({
    size,
    usage,
    label,
  }: {
    size: number
    usage: number
    label?: string
  }) => {
    const buffer = {
      size,
      usage,
      label,
      data: new Uint8Array(size),
      destroyed: false,
      destroy: () => void (buffer.destroyed = true),
      mapAsync: async () => {
        if (buffer.destroyed) {
          destroyedMaps++
          throw new DOMException('destroyed', 'OperationError')
        }
        if (failMap && label !== 'Trillion3D explicit capture') throw new Error('MAP_FAILED')
        await mapGate
        if (buffer.destroyed) throw new DOMException('destroyed while mapping', 'AbortError')
      },
      getMappedRange: () => buffer.data.buffer,
      unmap() {},
    }
    buffers.push(buffer)
    return buffer
  }
  return { buffers, createBuffer, destroyedMaps: () => destroyedMaps }
}
