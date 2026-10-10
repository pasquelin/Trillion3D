/**
 * Virtual-texture image feedback: what the pixels ASKED for, tile by tile.
 *
 * Each pixel posts in the feedback target the rank of the tile it wants, and a compute pass
 * (`reduce.ts`) counts one in sixteen, listing each tile the first time it is counted. At the end
 * of the image a second pass gathers each listed tile's count, zeroing its counter, and the list
 * alone is copied into a readback buffer: the tiles asked and their weights, never the table of every
 * tile. The read is asynchronous and comes back one image later, never blocking the current image.
 * Two readback buffers take turns: one maps while the other receives the next copy.
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

/** The most tiles one image lists: more than a pool serves in an image, and the readback they make
 *  stays the same whatever the textures the scene wears. A tile past it speaks again at the next
 *  phase. */
const FEEDBACK_HITS = 16384

/** The tiles an image asked, by feedback rank, each with the pixels that named it: the first
 *  `count` entries of `index` and `weight`. */
export type FeedbackHits = {
  readonly count: number
  readonly index: Uint32Array
  readonly weight: Uint32Array
}

export type WebgpuTileFeedback = {
  /** The counters, one per rank, the reduction adds to. */
  readonly buffer: GPUBuffer
  /** The list the reduction appends the tiles it counts to, and the gather fills the weights of:
   *  word 0 how many, then `capacity` ranks, then their `capacity` weights. */
  readonly list: GPUBuffer
  /** The most tiles the list holds. */
  readonly capacity: number
  readonly entries: number
  /** Counts `entries` ranks from now on, in new buffers: a page table grew. What came
   *  back, or is coming, counted the ranks before: dropped, never read. */
  grow(entries: number): void
  /** Word the uniform carries: the phase, or "every pixel" during a convergence, and the pick turn. */
  phaseWord(every: boolean): number
  /** Copies the list to a free readback buffer and empties it, in the image. */
  encode(encoder: GPUCommandEncoder): void
  /** The image is submitted: the copy it carried maps; the phase advances, and the pick with a
   *  whole phase round. */
  submitted(): void
  /** The last tiles that came back, once; `undefined` until some have come back. */
  take(): FeedbackHits | undefined
  /** Held when every in-flight read has come back. */
  settled(): Promise<void>
  destroy(): void
}

type Device = Pick<GPUDevice, 'createBuffer'>

export function createWebgpuTileFeedback(device: Device, entries: number): WebgpuTileFeedback {
  /** One generation of buffers: `count` counters, the list, its two readbacks, and what came back. */
  const allocate = (count: number) => {
    const capacity = Math.min(count, FEEDBACK_HITS)
    const words = 1 + 2 * capacity
    const bytes = Math.max(16, count * 4),
      listBytes = Math.max(16, words * 4)
    const buffer = (label: string, size: number, usage: number) =>
      device.createBuffer({ label, size, usage })
    return {
      count,
      capacity,
      words,
      listBytes,
      buffer: buffer('Trillion3D texture feedback', bytes, GPUBufferUsage.STORAGE),
      list: buffer(
        'Trillion3D texture feedback hits',
        listBytes,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      ),
      staging: [0, 1].map((rank) =>
        buffer(
          `Trillion3D texture feedback readback ${rank}`,
          listBytes,
          GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        ),
      ),
      // Per readback buffer: a copy encoded but not submitted, or an in-flight mapping.
      copied: [false, false],
      busy: [false, false],
      // The tiles that came back, one per readback buffer: nothing is allocated per image.
      held: [0, 1].map(() => {
        const read = new Uint32Array(Math.max(4, words))
        return {
          read,
          hits: {
            count: 0,
            index: read.subarray(1, 1 + capacity),
            weight: read.subarray(1 + capacity, 1 + 2 * capacity),
          },
        }
      }),
    }
  }
  let gen = allocate(entries)
  const inFlight = new Set<Promise<void>>()
  let next = 0,
    phase = 0,
    pick = 0,
    latest: FeedbackHits | undefined
  const destroy = () => {
    gen.buffer.destroy()
    gen.list.destroy()
    for (const target of gen.staging) target.destroy()
  }
  return {
    get buffer() {
      return gen.buffer
    },
    get list() {
      return gen.list
    },
    get capacity() {
      return gen.capacity
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
      const { busy, copied, list, staging, listBytes } = gen
      if (busy[next] || copied[next]) return
      encoder.copyBufferToBuffer(list, 0, staging[next], 0, listBytes)
      encoder.clearBuffer(list, 0, 4)
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
          const { read: words, hits } = read.held[rank]
          const mapped = new Uint32Array(target.getMappedRange(), 0, read.words)
          const count = Math.min(mapped[0], read.capacity)
          words.set(mapped.subarray(0, 1 + count))
          words.set(
            mapped.subarray(1 + read.capacity, 1 + read.capacity + count),
            1 + read.capacity,
          )
          target.unmap()
          hits.count = count
          latest = hits
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
