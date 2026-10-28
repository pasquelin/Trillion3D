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

/**
 * The buffers of `fakeDevice()`, which map as on a real device: their bytes are the mapped range;
 * mapping a destroyed buffer is a validation error on the device (`OperationError`, counted by
 * `destroyedMaps`); a mapping the destruction cuts short rejects with `AbortError`; unmapping ends the mapped range. A mapped range is the one asked (`mapAsync(mode, offset, size)`): bytes asked of `getMappedRange` outside it, while it is mapped, are an `OperationError`, as on a real device. Every mapping settles with `mapping`; `failMap` refuses every one but the explicit
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
    /** The range the last mapping asked, none while never mapped. */
    let mapped: [number, number] | undefined
    const buffer: FakeBuffer = {
      label: untag(label),
      size,
      usage,
      data: new Uint8Array(size),
      destroy: () => void destroyed.push(buffer),
      mapAsync: async (_mode?: number, offset = 0, size?: number) => {
        if (gone(buffer)) {
          destroyedMaps++
          throw new DOMException('destroyed', 'OperationError')
        }
        if (failMap && buffer.label !== 'Trillion3D explicit capture') throw new Error('MAP_FAILED')
        await mapping
        if (gone(buffer)) throw new DOMException('destroyed while mapping', 'AbortError')
        // Mapped once the mapping lands: until then the buffer is read whole, as the fake's writers before a flush do.
        mapped = [offset, offset + (size ?? buffer.size - offset)]
      },
      getMappedRange: (offset = 0, size?: number) => {
        // A buffer never mapped is read whole, as the fake's other readers do.
        if (mapped && (offset < mapped[0] || offset + (size ?? buffer.size - offset) > mapped[1]))
          throw new DOMException('range outside the mapped range', 'OperationError')
        return buffer.data.buffer as ArrayBuffer
      },
      // Unmapped, a buffer is read whole again, as the fake's other readers do.
      unmap: () => void (mapped = undefined),
    }
    buffers.push(buffer)
    return buffer
  }
  return { buffers, createBuffer, destroyedMaps: () => destroyedMaps }
}
