import type { FakeBuffer } from './fakeRecords.ts'
import { untag } from './fakeWebgpuDevice.ts'

/** The 32-bit words of `bytes`, where they sit in their buffer. */
export const words = (bytes: Uint8Array) =>
  new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)

/** The 32-bit floats of `bytes`, where they sit in their buffer. */
export const floats = (bytes: Uint8Array) =>
  new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)

/** A buffer's words as the vectors of `width` words a shader reads (`vec2u` doubles, `vec4u`
 *  records): reads and writes go to the words where they sit. */
export const vectors = (width: number, held: Uint32Array) =>
  new Proxy([] as number[][], {
    get(_, key) {
      if (key === 'length') return Math.floor(held.length / width)
      const at = typeof key === 'string' ? Number(key) : NaN
      return Number.isInteger(at)
        ? Array.from(held.subarray(at * width, at * width + width))
        : undefined
    },
    set(_, key, value: number[]) {
      held.set(value, Number(key) * width)
      return true
    },
  })

/** An entry of a bind group as a fake dispatch reads it: a buffer's binding, or a view's. */
export type BoundBuffer = { binding: number; resource: { buffer: { data: Uint8Array } } }

/** The resource a bind group's `entries` bind at `binding`. */
export const boundResource = (entries: readonly BoundBuffer[], binding: number) =>
  entries.find((entry) => entry.binding === binding)!.resource

/** The words of the buffer `entries` bind at `binding`, where they sit. */
export const boundWords = (entries: readonly BoundBuffer[], binding: number) =>
  words(boundResource(entries, binding).buffer.data)

/** The floats of the buffer `entries` bind at `binding`, where they sit. */
export const boundFloats = (entries: readonly BoundBuffer[], binding: number) =>
  floats(boundResource(entries, binding).buffer.data)

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
