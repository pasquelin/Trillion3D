/**
 * Virtual-texture image feedback: what the pixels ASKED for, tile by tile.
 *
 * Each pixel posts in the feedback target the rank of the tile it wants, and a compute pass
 * (`reduce.ts`) counts one in 256, listing each tile the first time it is counted. At the end
 * of the image a second pass gathers each listed tile's count, zeroing its counter, and the list
 * alone is copied into a readback buffer: the tiles asked and their weights, never the table of every
 * tile. The read is asynchronous and comes back one image later, never blocking the current image.
 * Two readback buffers take turns: one maps while the other receives the next copy.
 *
 * The phase advances from one image to the next so the 256 pixels of a square have all spoken in
 * 256 images, in an order that spreads the first of them over the square (`reversedMortonOffset`); a
 * barrier that must converge asks for every pixel at once.
 */
import { floorLog2 } from '../../../../math/src/scalar/integers.ts'
import { reversedMortonOffset } from '../../../../math/src/sequence/reversedMorton.ts'
import { PICK_CYCLE } from './pickCycle.ts'
import { createReadbackRing, type ReadbackRing } from '../../gpu/core/readbackRing.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { feedbackBuffers } from './feedbackBuffers.ts'
import { TILE_QUEUE_BYTES, type TileQueueCut } from './queueCut.ts'

/** Phase word: the `FEEDBACK_EVERY` bit asks for every pixel; otherwise the four low bits give the
 *  column and the next four the row of the speaking pixel in each `FEEDBACK_STRIDE` square,
 *  therefore `FEEDBACK_EVERY` phases before the whole square has been heard. Above them, from
 *  `PICK_SHIFT`, every image carries its pick turn (`PICK_CYCLE`). */
export const FEEDBACK_STRIDE = 16
export const FEEDBACK_EVERY = FEEDBACK_STRIDE * FEEDBACK_STRIDE
/** The bits of a coordinate inside a `FEEDBACK_STRIDE` square, and their count: the shift of the
 *  phase word's row field. */
export const FEEDBACK_STRIDE_MASK = FEEDBACK_STRIDE - 1
export const FEEDBACK_STRIDE_BITS = floorLog2(FEEDBACK_STRIDE)
/** The side of the square of pixels one speaking pixel stands for under phase word `word`: the
 *  CPU's read of the one stride rule (`FEEDBACK_STRIDE_WGSL`, `requestWgsl.ts`). */
export const feedbackStrideOf = (word: number) => (word & FEEDBACK_EVERY ? 1 : FEEDBACK_STRIDE)
/** First bit above the phase and the `FEEDBACK_EVERY` bit. */
export const PICK_SHIFT = floorLog2(FEEDBACK_EVERY) + 1

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
  /** Copies the list to a free readback buffer and empties it, in the image; the eviction queues
   *  of `cut` ride behind it, handed to it when they land (`evictSort.ts`). */
  encode(encoder: GPUCommandEncoder, cut?: TileQueueCut): void
  /** Whether a readback buffer is free for `encode`. */
  available(): boolean
  /** The image is submitted: the copy it carried maps; the phase advances, and the pick with a
   *  whole phase round. */
  submitted(): void
  /** The last tiles that came back, once; `undefined` until some have come back. */
  take(): FeedbackHits | undefined
  /** Held when every in-flight read has come back. */
  settled(): Promise<void>
  destroy(): void
}

type MutableHits = { count: number; index: Uint32Array; weight: Uint32Array }

/** Each readback buffer's record: the eviction queues it carries behind its list and where they
 *  start, and the tiles that came back in it, kept per generation — nothing allocated per image. */
type Staged = {
  cut: TileQueueCut | undefined
  at: number
  came?: { generation: number; read: Uint32Array; hits: MutableHits }
}

/** What the feedback changes as images pass: the current generation of buffers, the last tiles
 *  that came back, the phase and the pick turn, and whether this image encoded its copy. */
type FeedbackState = {
  gen: ReturnType<typeof feedbackBuffers>
  latest: FeedbackHits | undefined
  phase: number
  pick: number
  encoded: boolean
}

const createStaged = () => {
  const staged = new WeakMap<GPUBuffer, Staged>()
  return (buffer: GPUBuffer) => {
    let record = staged.get(buffer)
    if (!record) staged.set(buffer, (record = { cut: undefined, at: 0 }))
    return record
  }
}

/** A readback landed: the queues it carried are followed, and the tiles of the current generation
 *  become the last that came back. */
function landFeedback(fb: FeedbackState, record: Staged, mapped: ArrayBuffer, generation: number) {
  // A queue names places, never ranks: read whatever the generation.
  if (record.cut) record.cut.read(new Uint32Array(mapped, record.at, TILE_QUEUE_BYTES / 4))
  if (generation !== fb.gen.generation) return
  const { capacity, words } = fb.gen
  let slot = record.came
  if (slot?.generation !== generation) {
    const read = new Uint32Array(Math.max(4, words))
    slot = {
      generation,
      read,
      hits: {
        count: 0,
        index: read.subarray(1, 1 + capacity),
        weight: read.subarray(1 + capacity, 1 + 2 * capacity),
      },
    }
    record.came = slot
  }
  const view = new Uint32Array(mapped, 0, words)
  const count = Math.min(view[0], capacity)
  slot.read.set(view.subarray(0, 1 + count))
  slot.read.set(view.subarray(1 + capacity, 1 + capacity + count), 1 + capacity)
  slot.hits.count = count
  fb.latest = slot.hits
}

/** Copies the list to a free readback buffer and empties it, the queues of `cut` behind it. */
function encodeFeedback(
  fb: FeedbackState,
  ring: ReadbackRing<number>,
  stagedOf: (buffer: GPUBuffer) => Staged,
  encoder: GPUCommandEncoder,
  cut?: TileQueueCut,
) {
  const { gen } = fb
  if (fb.encoded) return
  const target = ring.take(gen.generation, gen.listBytes + (cut ? TILE_QUEUE_BYTES : 0))
  if (!target) return
  encoder.copyBufferToBuffer(gen.list, 0, target, 0, gen.listBytes)
  if (cut) encoder.copyBufferToBuffer(cut.buffer, 0, target, gen.listBytes, TILE_QUEUE_BYTES)
  const record = stagedOf(target)
  record.cut = cut
  record.at = gen.listBytes
  encoder.clearBuffer(gen.list, 0, 4)
  fb.encoded = true
}

/** Counts `ranks` ranks from now on, in new buffers: what came back counted the ranks before. */
function growFeedback(device: GPUDevice, fb: FeedbackState, ranks: number) {
  const next = feedbackBuffers(device, ranks, fb.gen.generation + 1)
  retire(device, fb.gen.buffer)
  retire(device, fb.gen.list)
  fb.gen = next
  fb.encoded = false
  fb.latest = undefined
}

/**
 * One ring of readback buffers serves every generation: each take asks the generation's list size
 * (`createReadbackRing`), a free buffer too small made again at it, and carries its generation —
 * a read of another one counted the ranks before: dropped, never read. A generation grown past
 * leaves its counters and list to the frame-end retire list (`frameRetire.ts`): commands of this
 * image not yet submitted may name them.
 */
export function createWebgpuTileFeedback(device: GPUDevice, entries: number): WebgpuTileFeedback {
  const fb: FeedbackState = {
    gen: feedbackBuffers(device, entries, 0),
    latest: undefined,
    phase: 0,
    pick: 0,
    encoded: false,
  }
  const stagedOf = createStaged()
  const ring = createReadbackRing<number>(
    device,
    {
      label: 'Trillion3D texture feedback readback',
      bytes: fb.gen.listBytes,
      count: 2,
      eager: true,
    },
    (mapped, staging, generation) => landFeedback(fb, stagedOf(staging), mapped, generation),
  )
  return {
    get buffer() {
      return fb.gen.buffer
    },
    get list() {
      return fb.gen.list
    },
    get capacity() {
      return fb.gen.capacity
    },
    get entries() {
      return fb.gen.count
    },
    grow: (ranks) => growFeedback(device, fb, ranks),
    phaseWord: (every) =>
      (every ? FEEDBACK_EVERY : 0) |
      reversedMortonOffset(fb.phase, FEEDBACK_STRIDE) |
      (fb.pick << PICK_SHIFT),
    encode: (encoder, cut) => encodeFeedback(fb, ring, stagedOf, encoder, cut),
    submitted() {
      fb.phase = (fb.phase + 1) % FEEDBACK_EVERY
      if (fb.phase === 0) fb.pick = (fb.pick + 1) % PICK_CYCLE
      if (!fb.encoded) return
      fb.encoded = false
      ring.submitted()
    },
    take() {
      const counts = fb.latest
      fb.latest = undefined
      return counts
    },
    available: () => ring.available(),
    settled: () => ring.settled(),
    destroy() {
      fb.gen.buffer.destroy()
      fb.gen.list.destroy()
      ring.destroy()
    },
  }
}
