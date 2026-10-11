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
import { createReadbackRing, type ReadbackRing } from '../../gpu/core/readbackRing.ts'

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

type MutableHits = { count: number; index: Uint32Array; weight: Uint32Array }

export function createWebgpuTileFeedback(device: Device, entries: number): WebgpuTileFeedback {
  /** One generation of buffers: `count` counters, the list, its readbacks, and what came back. */
  const allocate = (count: number) => {
    const capacity = Math.min(count, FEEDBACK_HITS)
    const words = 1 + 2 * capacity
    const bytes = Math.max(16, count * 4),
      listBytes = Math.max(16, words * 4)
    const buffer = (label: string, size: number, usage: number) =>
      device.createBuffer({ label, size, usage })
    // The tiles that came back, one per readback buffer: nothing is allocated per image.
    const held = new Map<GPUBuffer, { read: Uint32Array; hits: MutableHits }>()
    const ring = createReadbackRing(
      device,
      { label: 'Trillion3D texture feedback readback', bytes: listBytes, count: 2, eager: true },
      (mapped, staging) => {
        let slot = held.get(staging)
        if (!slot) {
          const read = new Uint32Array(Math.max(4, words))
          slot = {
            read,
            hits: {
              count: 0,
              index: read.subarray(1, 1 + capacity),
              weight: read.subarray(1 + capacity, 1 + 2 * capacity),
            },
          }
          held.set(staging, slot)
        }
        const view = new Uint32Array(mapped, 0, words)
        const count = Math.min(view[0], capacity)
        slot.read.set(view.subarray(0, 1 + count))
        slot.read.set(view.subarray(1 + capacity, 1 + capacity + count), 1 + capacity)
        slot.hits.count = count
        latest = slot.hits
      },
    )
    return {
      count,
      capacity,
      listBytes,
      buffer: buffer('Trillion3D texture feedback', bytes, GPUBufferUsage.STORAGE),
      list: buffer(
        'Trillion3D texture feedback hits',
        listBytes,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      ),
      ring,
    }
  }
  let latest: FeedbackHits | undefined
  let gen = allocate(entries)
  // The rings of the generations grown past, until their last read has come back.
  const retired = new Set<ReadbackRing>()
  let phase = 0,
    pick = 0,
    encoded = false
  const destroy = () => {
    gen.buffer.destroy()
    gen.list.destroy()
    gen.ring.destroy()
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
      const old = gen.ring
      retired.add(old)
      void old.settled().then(() => retired.delete(old))
      const next = allocate(ranks)
      destroy()
      gen = next
      encoded = false
      latest = undefined
    },
    phaseWord: (every) => (every ? FEEDBACK_EVERY : 0) | phase | (pick << PICK_SHIFT),
    encode(encoder) {
      if (encoded) return
      const target = gen.ring.take()
      if (!target) return
      encoder.copyBufferToBuffer(gen.list, 0, target, 0, gen.listBytes)
      encoder.clearBuffer(gen.list, 0, 4)
      encoded = true
    },
    submitted() {
      phase = (phase + 1) % FEEDBACK_EVERY
      if (phase === 0) pick = (pick + 1) % PICK_CYCLE
      if (!encoded) return
      encoded = false
      gen.ring.submitted()
    },
    take() {
      const counts = latest
      latest = undefined
      return counts
    },
    settled: () =>
      Promise.all([gen.ring, ...retired].map((ring) => ring.settled())).then(() => undefined),
    destroy,
  }
}
