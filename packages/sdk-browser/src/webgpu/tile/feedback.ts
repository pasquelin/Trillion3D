/**
 * Virtual-texture image feedback: what the pixels ASKED for, tile by tile.
 *
 * Each pixel posts in the feedback target the rank of the tile it wants, and a compute pass
 * (`reduce.ts`) counts one in sixteen. At the end of the image, the counters are copied
 * into a readback buffer and zeroed; the read is asynchronous and comes back one image later, never
 * blocking the current image. Two readback buffers take turns: one maps while the other receives the
 * next copy.
 *
 * The phase advances from one image to the next so the sixteen pixels of a square have all spoken in
 * sixteen images; a barrier that must converge asks for every pixel at once.
 */
import { floorLog2 } from '../../../../math/src/scalar/integers.ts'
import { PICK_CYCLE } from './pickCycle.ts'

/** Phase word: the `FEEDBACK_EVERY` bit asks for every pixel; otherwise the two low bits give the
 *  column and the next two the row of the speaking pixel in each `FEEDBACK_STRIDE` square, therefore
 *  `FEEDBACK_EVERY` phases before the whole square has been heard. Above them, from `PICK_SHIFT`,
 *  every image carries its pick turn (`PICK_CYCLE`). */
export const FEEDBACK_STRIDE = 4
export const FEEDBACK_EVERY = FEEDBACK_STRIDE * FEEDBACK_STRIDE
/** First bit above the phase and the `FEEDBACK_EVERY` bit. */
export const PICK_SHIFT = floorLog2(FEEDBACK_EVERY) + 1

export type WebgpuTileFeedback = {
  readonly buffer: GPUBuffer
  readonly entries: number
  /** Counts `entries` ranks from now on, in new buffers: a page table grew. What came
   *  back, or is coming, counted the ranks before: dropped, never read. */
  grow(entries: number): void
  /** Word the uniform carries: the phase, or "every pixel" during a convergence, and the pick turn. */
  phaseWord(every: boolean): number
  /** Copies the counters to a free readback buffer and zeroes them, in the image. */
  encode(encoder: GPUCommandEncoder): void
  /** The image is submitted: the copy it carried maps; the phase advances, and the pick with a
   *  whole phase round. */
  submitted(): void
  /** The last counters that came back, once; `undefined` until one has come back. */
  take(): Uint32Array | undefined
  /** Held when every in-flight read has come back. */
  settled(): Promise<void>
  destroy(): void
}

type Device = Pick<GPUDevice, 'createBuffer'>

export function createWebgpuTileFeedback(device: Device, entries: number): WebgpuTileFeedback {
  /** One generation of buffers: `count` counters, their two readbacks, and what came back. */
  const allocate = (count: number) => {
    const bytes = Math.max(16, count * 4)
    const buffer = (label: string, usage: number) =>
      device.createBuffer({ label, size: bytes, usage })
    return {
      count,
      bytes,
      buffer: buffer(
        'Trillion3D texture feedback',
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      ),
      staging: [0, 1].map((rank) =>
        buffer(
          `Trillion3D texture feedback readback ${rank}`,
          GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        ),
      ),
      // Per readback buffer: a copy encoded but not submitted, or an in-flight mapping.
      copied: [false, false],
      busy: [false, false],
      // Counters that came back, one array per readback buffer: nothing is allocated per image.
      held: [0, 1].map(() => new Uint32Array(count)),
    }
  }
  let gen = allocate(entries)
  const inFlight = new Set<Promise<void>>()
  let next = 0,
    phase = 0,
    pick = 0,
    latest: Uint32Array | undefined
  const destroy = () => {
    gen.buffer.destroy()
    for (const target of gen.staging) target.destroy()
  }
  return {
    get buffer() {
      return gen.buffer
    },
    get entries() {
      return gen.count
    },
    grow(ranks) {
      const next = allocate(ranks)
      destroy()
      gen = next
      latest = undefined
    },
    phaseWord: (every) => (every ? FEEDBACK_EVERY : 0) | phase | (pick << PICK_SHIFT),
    encode(encoder) {
      const { busy, copied, buffer, staging, bytes } = gen
      if (busy[next] || copied[next]) return
      encoder.copyBufferToBuffer(buffer, 0, staging[next], 0, bytes)
      encoder.clearBuffer(buffer)
      copied[next] = true
    },
    submitted() {
      phase = (phase + 1) % FEEDBACK_EVERY
      if (phase === 0) pick = (pick + 1) % PICK_CYCLE
      const read = gen
      if (!read.copied[next]) return
      const rank = next,
        target = read.staging[rank]
      read.copied[rank] = false
      read.busy[rank] = true
      const mapped = target
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          // A read of a generation grown past counted the ranks before: dropped, never read.
          if (read !== gen) return
          read.held[rank].set(new Uint32Array(target.getMappedRange(), 0, read.count))
          target.unmap()
          latest = read.held[rank]
        })
        .catch(() => undefined)
        .finally(() => {
          read.busy[rank] = false
          inFlight.delete(mapped)
        })
      inFlight.add(mapped)
      next ^= 1
    },
    take() {
      const counts = latest
      latest = undefined
      return counts
    },
    settled: () => Promise.all(inFlight).then(() => undefined),
    destroy,
  }
}
