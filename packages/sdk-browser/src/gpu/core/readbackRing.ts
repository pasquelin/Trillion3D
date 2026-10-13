/** `GPUMapMode.READ`, or its value where a test device leaves the enum empty. */
const mapRead = () => (globalThis as { GPUMapMode?: { READ: number } }).GPUMapMode?.READ ?? 1

/** Maps `buffer`, or its range `offset` and `size`, for reading: held when the GPU has run the
 *  copies into it. The one mapping of a staging buffer that a caller awaits. */
export const mapStaging = (buffer: GPUBuffer, offset?: number, size?: number) =>
  Promise.resolve(buffer.mapAsync(mapRead(), offset, size))

/** A staging buffer of `bytes` bytes under `label`: a copy lands in it, and it maps for reading. */
const createStaging = (device: Pick<GPUDevice, 'createBuffer'>, label: string, bytes: number) =>
  device.createBuffer({
    label,
    size: bytes,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  })

/** A chained read's mapping the device refused, or `destroy` cut short: the one failure such a
 *  read meets quietly — a device lost says so on its own (`device.lost`). Any other is the
 *  caller's. */
export class ReadbackRefused extends Error {}

interface Staging<T> {
  buffer: GPUBuffer
  /** What the frame that took the buffer says of its copy, given back to `read`. */
  tag: T
  /** The mapping's callbacks, made once with the buffer: a frame allocates no closure. */
  mapped(): void
  failed(): void
}

/** A ring of staging buffers read back without a wait (`createReadbackRing`). */
export interface ReadbackRing<T = number> {
  /** A buffer of `bytes` bytes at least (the ring's size by default) to copy this frame's words
   *  into, none while all are in flight or where the device cannot make or map it. A copy whose
   *  encoder was never submitted is still pending: this frame's copy takes its place, and its
   *  `tag` — on a chained ring, never: each take is settled by `submitted` or `dropped`. */
  take(tag?: T, bytes?: number): GPUBuffer | undefined
  /** Whether `take` would give a buffer. */
  available(): boolean
  /** Buffers taken and not back yet: copies not submitted, and mappings in flight. */
  held(): number
  /** Bytes the ring's buffers hold. */
  readonly bytes: number
  /** After `queue.submit` of the encoder the copy was recorded in: the taken buffer — `buffer`
   *  alone, else every one taken — maps. */
  submitted(buffer?: GPUBuffer): void
  /** The encoder the copy was recorded in is never submitted: the taken buffer — `buffer` alone,
   *  else every one taken — is free again, read never. */
  dropped(buffer?: GPUBuffer): void
  /** Held when every mapping in flight has come back. */
  settled(): Promise<void>
  destroy(): void
}

/**
 * THE ONE RING OF STAGING BUFFERS a counter, a status word, a cut's lists or an image's timestamps
 * come back through a few frames late: a frame `take`s one, copies into it, and once its encoder is
 * submitted (`submitted`) the buffer maps, `read` sees its range in place (no copy of it), and it
 * is free again. No frame waits: when every buffer is in flight, `take` gives none and that frame
 * samples nothing.
 *
 * At most `count` buffers under `label`, each of `bytes` bytes or what a take asks — a free one too
 * small for it is made again at its size —, made when first taken (all at once with `eager`).
 * `read(mapped, staging, tag)` runs when a buffer maps, over the mapped range valid for that call
 * alone. With `chain`, a caller whose reads land in order is handed each read (`chain(read, tag)`)
 * to run behind its own work: the buffer is mapped only then, the read awaited there, and a mapping
 * refused rejects with `ReadbackRefused`.
 */
export function createReadbackRing<T = number>(
  device: Pick<GPUDevice, 'createBuffer'>,
  options: {
    label: string
    bytes: number
    count: number
    eager?: boolean
    chain?: (read: () => Promise<void>, tag: T) => void
  },
  read: (mapped: ArrayBuffer, staging: GPUBuffer, tag: T) => void,
): ReadbackRing<T> {
  const free: Staging<T>[] = [],
    pending: Staging<T>[] = [],
    all: Staging<T>[] = []
  const { chain } = options
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
  const make = (bytes: number) => {
    let buffer: GPUBuffer
    try {
      buffer = createStaging(device, options.label, bytes)
    } catch {
      // Refused — the budget, the device —: this take gets none, the next asks again.
      return undefined
    }
    if (typeof buffer?.mapAsync !== 'function' || typeof buffer.getMappedRange !== 'function') {
      buffer?.destroy()
      unmappable = true
      return undefined
    }
    const staging: Staging<T> = {
      buffer,
      tag: undefined as T,
      mapped() {
        if (destroyed) return landed()
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
  /** A free buffer of `bytes` at least: one held, made again when too small, or a new one. */
  const freeOf = (bytes: number) => {
    const staging = free.pop()
    if (!staging) return room() ? make(bytes) : undefined
    if (staging.buffer.size >= bytes) return staging
    all.splice(all.indexOf(staging), 1)
    staging.buffer.destroy()
    return make(bytes)
  }
  /** The chained read of `staging`: mapped behind the caller's work, read, given back. */
  const mapThenRead = async (staging: Staging<T>) => {
    if (destroyed) return landed()
    try {
      await mapStaging(staging.buffer)
    } catch (cause) {
      staging.failed()
      throw new ReadbackRefused('READBACK_MAP_REFUSED', { cause })
    }
    staging.mapped()
  }
  const map = (staging: Staging<T>) => {
    flying++
    if (chain) chain(() => mapThenRead(staging), staging.tag)
    else staging.buffer.mapAsync(mapRead()).then(staging.mapped, staging.failed)
  }
  const back = (staging: Staging<T>) => void (destroyed || free.push(staging))
  /** Settles the taken buffers — `buffer` alone, else all — by `act`, in the order taken. */
  const settle = (buffer: GPUBuffer | undefined, act: (staging: Staging<T>) => void) => {
    let kept = 0
    for (const staging of pending.splice(0))
      if (buffer && staging.buffer !== buffer) pending[kept++] = staging
      else act(staging)
  }
  if (options.eager) {
    for (let k = 0; k < options.count && room(); k++) make(options.bytes)
    // Taken in the order made; each one read is the next taken.
    free.push(...all.slice().reverse())
  }
  return {
    take(tag, bytes = options.bytes) {
      if (destroyed) return undefined
      const last = chain ? undefined : pending.pop()
      if (last && last.buffer.size >= bytes) {
        last.tag = tag as T
        pending.push(last)
        return last.buffer
      }
      if (last) free.push(last)
      const staging = freeOf(bytes)
      if (!staging) return undefined
      staging.tag = tag as T
      pending.push(staging)
      return staging.buffer
    },
    available: () => !destroyed && ((!chain && pending.length > 0) || free.length > 0 || room()),
    held: () => pending.length + flying,
    get bytes() {
      return all.reduce((sum, staging) => sum + staging.buffer.size, 0)
    },
    submitted: (buffer) => settle(buffer, map),
    dropped: (buffer) => settle(buffer, back),
    settled: () =>
      flying > 0 ? new Promise<void>((resolve) => waiting.push(resolve)) : Promise.resolve(),
    destroy() {
      destroyed = true
      for (const staging of all) staging.buffer.destroy()
      all.length = free.length = pending.length = 0
    },
  }
}
