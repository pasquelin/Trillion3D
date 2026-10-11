/** `GPUMapMode.READ`, or its value where a test device leaves the enum empty. */
const mapRead = () => (globalThis as { GPUMapMode?: { READ: number } }).GPUMapMode?.READ ?? 1

/** Maps `buffer`, or its range `offset` and `size`, for reading: held when the GPU has run the
 *  copies into it. The one mapping of a staging buffer that a caller awaits. */
export const mapStaging = (buffer: GPUBuffer, offset?: number, size?: number) =>
  Promise.resolve(buffer.mapAsync(mapRead(), offset, size))

interface Staging {
  buffer: GPUBuffer
  /** What the frame that took the buffer says of its copy, given back to `read`. */
  tag: number
  /** The mapping's callbacks, made once with the buffer: a frame allocates no closure. */
  mapped(): void
  failed(): void
}

/** A ring of staging buffers read back without a wait (`createReadbackRing`). */
export interface ReadbackRing {
  /** A buffer to copy this frame's `bytes` into, none while all are in flight or where the device
   *  cannot map. A copy whose encoder was never submitted is still pending: this frame's copy takes
   *  its place, and its `tag`. */
  take(tag?: number): GPUBuffer | undefined
  /** Whether `take` would give a buffer. */
  available(): boolean
  /** After `queue.submit` of the encoder the copy was recorded in: the taken buffer maps. */
  submitted(): void
  /** Held when every mapping in flight has come back. */
  settled(): Promise<void>
  destroy(): void
}

/**
 * The ring of staging buffers a counter or a status word comes back through a few frames late:
 * a frame `take`s one, copies into it, and once its encoder is submitted (`submitted`) the buffer
 * maps, `read` sees its range in place (no copy of it), and it is free again. No frame waits: when
 * every buffer is in flight, `take` gives none and that frame samples nothing.
 *
 * A ring of at most `count` buffers of `bytes` bytes under `label`, made when first taken (all
 * at once with `eager`). `read(mapped, staging, tag)` runs when a buffer maps, over the mapped
 * range valid for that call alone.
 */
export function createReadbackRing(
  device: Pick<GPUDevice, 'createBuffer'>,
  options: { label: string; bytes: number; count: number; eager?: boolean },
  read: (mapped: ArrayBuffer, staging: GPUBuffer, tag: number) => void,
): ReadbackRing {
  const free: Staging[] = [],
    pending: Staging[] = [],
    all: Staging[] = []
  let destroyed = false,
    unmappable = false,
    flying = 0
  let waiting: Array<() => void> = []
  const landed = () => {
    if (--flying > 0) return
    const done = waiting
    waiting = []
    for (const resolve of done) resolve()
  }
  const make = () => {
    let buffer: GPUBuffer | undefined
    try {
      buffer = device.createBuffer({
        label: options.label,
        size: options.bytes,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      })
    } catch {
      /* A device that cannot make the buffer cannot map it either. */
    }
    if (typeof buffer?.mapAsync !== 'function' || typeof buffer.getMappedRange !== 'function') {
      buffer?.destroy()
      unmappable = true
      return undefined
    }
    const staging: Staging = {
      buffer,
      tag: 0,
      mapped() {
        if (destroyed) {
          landed()
          return
        }
        try {
          read(buffer.getMappedRange(), buffer, staging.tag)
        } finally {
          buffer.unmap()
          free.push(staging)
          landed()
        }
      },
      failed() {
        if (!destroyed) free.push(staging)
        landed()
      },
    }
    all.push(staging)
    return staging
  }
  const room = () => !destroyed && !unmappable && all.length < options.count
  if (options.eager)
    for (let k = 0; k < options.count && room(); k++) {
      const staging = make()
      if (staging) free.push(staging)
    }
  return {
    take(tag = 0) {
      if (destroyed) return undefined
      if (pending.length > 0) {
        const last = pending[pending.length - 1]
        last.tag = tag
        return last.buffer
      }
      const staging = free.pop() ?? (room() ? make() : undefined)
      if (!staging) return undefined
      staging.tag = tag
      pending.push(staging)
      return staging.buffer
    },
    available: () => !destroyed && (pending.length > 0 || free.length > 0 || room()),
    submitted() {
      for (let k = 0; k < pending.length; k++) {
        const staging = pending[k]
        flying++
        staging.buffer.mapAsync(mapRead()).then(staging.mapped, staging.failed)
      }
      pending.length = 0
    },
    settled: () =>
      flying > 0 ? new Promise<void>((resolve) => waiting.push(resolve)) : Promise.resolve(),
    destroy() {
      destroyed = true
      for (const staging of all) staging.buffer.destroy()
      all.length = free.length = pending.length = 0
    },
  }
}
