import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import {
  feedbackBufferSize,
  feedbackTileJitter,
  feedbackTileSize,
  feedbackUniqueElements,
  type Feedback,
} from '../../../../sdk-core/src/lighting/surfaceCache/feedback.ts'
import type { SurfaceCache } from '../../../../sdk-core/src/lighting/surfaceCache/state.ts'
import { advanceFeedbackFrame } from '../../../../sdk-core/src/lighting/surfaceCache/update.ts'
import { bufferEntries, computeBufferEntry } from '../../gpu/core/computeBindings.ts'
import { startedComputeStages } from '../../gpu/core/computeStages.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { createReadbackRing } from '../../gpu/core/readbackRing.ts'
import { FEEDBACK_AT, FEEDBACK_HEADER_WORDS, feedbackWords } from './feedbackLayout.ts'
import { FEEDBACK_COMPACTION_ENTRIES, FEEDBACK_COMPACTION_SHADER } from './feedbackWgsl.ts'

/**
 * THE FEEDBACK OF THE RAYS THAT READ THE CARDS, on the GPU and back (`sampleWgsl.ts` writes it, `feedback.ts`
 * of the core takes it): one buffer the rays of an image write into, the compaction of what they wrote, and
 * the read-back of the list.
 *
 * `begin` makes ready the image's buffer — one element for each tile of the image (`feedbackBufferSize`),
 * the two last-read parts one word a page of the page table —, its header written: the count at zero,
 * the parts' places, the tile's size and place in it (`feedbackTileJitter`, which the feedback clock moves
 * on from image to image), the cache's clock and the level bias. The last-read parts persist between
 * images: the buffer is made again, and they begin again, only when the image's size or the page table's
 * room changes. `end` then compacts it (`feedbackWgsl.ts`: the table of keys and the list cleared, the
 * two kernels, the list copied to a staging buffer of the ring) and moves the feedback clock on, the
 * way the clock of the pages' last reads moves with the images that wrote feedback. No image waits for the list:
 * its staging buffers (`IN_FLIGHT`) map when the copy's image is submitted — the next image's `begin` says it
 * is —, and `take` gives the newest list that came back, once, for the cache's update to read.
 * Where all the staging buffers are in flight, the image's feedback is dropped, as the reference's is.
 */

/** Lists in flight at once. */
const IN_FLIGHT = 4

/** What the buffer was made for. */
interface Held {
  readonly buffer: GPUBuffer
  readonly elements: number
  readonly words: ReturnType<typeof feedbackWords>
}

/** What the compaction holds for a list of `unique` elements: the keys, the first element's rank of each place, its
 *  count, and the list, each twice as many words as the list holds elements — a table of twice the room. */
interface Table {
  readonly unique: number
  readonly buffers: readonly GPUBuffer[]
  readonly listed: GPUBuffer
}

const storage = (device: GPUDevice, label: string, words: number, extra = 0) =>
  device.createBuffer({
    label: `Trillion3D surface cache feedback ${label}`,
    size: words * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | extra,
  })

/** The table and the list for `unique` elements. */
function createTable(device: GPUDevice, unique: number): Table {
  const [keys, firsts, counts] = ['keys', 'firsts', 'counts'].map((name) =>
    storage(device, name, 2 * unique),
  )
  const listed = storage(device, 'list', 2 * unique, GPUBufferUsage.COPY_SRC)
  return { unique, buffers: [keys, firsts, counts, listed], listed }
}

/** The compaction's kernels, started: their group's layout (the feedback buffer read, the four others written). */
function createKernels(device: GPUDevice) {
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(0, 'read-only-storage'),
      ...[1, 2, 3, 4].map((binding) => computeBufferEntry(binding, 'storage')),
    ],
  })
  const stages = startedComputeStages(
    device,
    'Trillion3D surface cache feedback',
    device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    device.createShaderModule({
      label: 'Trillion3D surface cache feedback compaction',
      code: FEEDBACK_COMPACTION_SHADER,
    }),
    FEEDBACK_COMPACTION_ENTRIES,
  )
  return { layout, stages }
}

/** The compaction (`feedbackWgsl.ts`) on `device`: its kernels, its table and its group over the buffer it reads. */
function createCompaction(device: GPUDevice) {
  const { layout, stages } = createKernels(device)
  let table: Table | undefined
  let group: GPUBindGroup | undefined
  let bound: GPUBuffer | undefined
  return {
    get ready() {
      return stages.ready
    },
    /** The table of `unique` elements, its group over `buffer`: kept while they are what is asked. */
    ensure(buffer: GPUBuffer, unique: number) {
      if (!table || table.unique !== unique) {
        if (table) for (const old of table.buffers) retire(device, old)
        table = createTable(device, unique)
        group = undefined
      }
      if (bound !== buffer) group = undefined
      bound = buffer
      group ??= device.createBindGroup({
        label: 'Trillion3D surface cache feedback compaction',
        layout,
        entries: bufferEntries([buffer, ...table.buffers]),
      })
    },
    /** The bytes of the list. */
    get bytes() {
      return table?.listed.size ?? 0
    },
    /** The table cleared, the two kernels over `elements` elements, the list copied to `staging`. */
    encode(encoder: GPUCommandEncoder, elements: number, staging: GPUBuffer) {
      if (!table || !group || !stages.ready) return
      const [keys, , counts, listed] = table.buffers
      for (const buffer of [keys, counts, listed]) encoder.clearBuffer(buffer)
      const pass = encoder.beginComputePass({ label: 'Trillion3D surface cache feedback' })
      pass.setBindGroup(0, group)
      pass.setPipeline(stages.pipelineOf('buildFeedbackTable'))
      dispatchRows(pass, ceilDiv(elements, WORKGROUP_THREADS))
      pass.setPipeline(stages.pipelineOf('compactFeedbackTable'))
      dispatchRows(pass, ceilDiv(2 * table.unique, WORKGROUP_THREADS))
      pass.end()
      encoder.copyBufferToBuffer(listed, 0, staging, 0, listed.size)
    },
    reset() {
      for (const buffer of table?.buffers ?? []) buffer.destroy()
      table = group = bound = undefined
    },
  }
}

/** The buffer the rays write (`feedbackLayout.ts`) on `device`, and the header it is written for each image. */
function createFeedbackBuffer(device: GPUDevice) {
  const header = new Uint32Array(FEEDBACK_HEADER_WORDS)
  const headerFloats = new Float32Array(header.buffer)
  let held: Held | undefined
  return {
    get held() {
      return held
    },
    /** The buffer for an image of `elements` tiles and a page table of `pages` records: kept while it is what the image
     *  asks, else made again (the last-read parts begin again), and its header written: the count at zero, the parts' places,
     *  the tile and where in it the rays write, the cache's clock. */
    begin(elements: number, pages: number, cache: SurfaceCache, tile: number) {
      const words = feedbackWords(elements, pages)
      if (!held || held.elements !== elements || held.words.pages < words.pages) {
        if (held) retire(device, held.buffer)
        held = { buffer: storage(device, 'buffer', words.words), elements, words }
      }
      const [jitterX, jitterY] = feedbackTileJitter(cache.feedbackFrame, tile)
      header.fill(0)
      header[FEEDBACK_AT.elements] = held.words.elements
      header[FEEDBACK_AT.lastUsed] = held.words.lastUsed
      header[FEEDBACK_AT.lastUsedHiRes] = held.words.lastUsedHiRes
      header[FEEDBACK_AT.size] = elements
      header[FEEDBACK_AT.wrapMask] = tile - 1
      header[FEEDBACK_AT.jitterX] = jitterX
      header[FEEDBACK_AT.jitterY] = jitterY
      header[FEEDBACK_AT.frame] = cache.frame
      headerFloats[FEEDBACK_AT.resLevelBias] = cache.settings.surfaceCacheFeedbackResLevelBias
      device.queue.writeBuffer(held.buffer, 0, header)
      return held
    },
    reset() {
      held?.buffer.destroy()
      held = undefined
    },
  }
}

/** The surface cache's feedback on `device`. */
export function createSurfaceFeedback(device: GPUDevice) {
  const compaction = createCompaction(device)
  const rays = createFeedbackBuffer(device)
  let latest: Feedback | undefined
  let active = false
  const ring = createReadbackRing<number>(
    device,
    { label: 'Trillion3D surface cache feedback readback', bytes: 16, count: IN_FLIGHT },
    (mapped, _staging, bufferSize) => {
      const words = new Uint32Array(mapped.slice(0))
      latest = { words, capacity: words.length / 2, bufferSize }
    },
  )
  return {
    /** The buffer of the image `begin` made ready, none where the image writes no feedback. */
    get buffer() {
      return active ? rays.held?.buffer : undefined
    },
    /** Makes the feedback of an image of `size` pixels ready for `cache`: its buffer, the table of its compaction, its
     *  header; none where the cache's feedback is off or the kernels are not compiled. The copy of the image before, now
     *  submitted, maps. */
    begin(cache: SurfaceCache, size: readonly [number, number]) {
      ring.submitted()
      const { settings } = cache
      active = settings.surfaceCacheFeedback && compaction.ready && ring.available()
      if (!active) return undefined
      const tile = feedbackTileSize(settings)
      const elements = Math.max(1, feedbackBufferSize(size[0], size[1], tile))
      const now = rays.begin(elements, cache.pages.length, cache, tile)
      compaction.ensure(now.buffer, feedbackUniqueElements(settings))
      return now.buffer
    },
    /** After the rays of the image wrote: their elements compacted into the list, which is copied to the ring, the
     *  feedback clock moved on. */
    end(encoder: GPUCommandEncoder, cache: SurfaceCache) {
      const now = rays.held
      const staging = active && now && ring.take(now.elements, compaction.bytes)
      if (!staging) return
      compaction.encode(encoder, now.elements, staging)
      advanceFeedbackFrame(cache)
    },
    /** The newest list that came back, once: the feedback the cache's update takes. */
    take() {
      const feedback = latest
      latest = undefined
      return feedback
    },
    /** Forgets the images' feedback and gives back its buffers: the cache it was for is made again. */
    reset() {
      rays.reset()
      compaction.reset()
      latest = undefined
      active = false
    },
    dispose() {
      ring.destroy()
      this.reset()
    },
  }
}

/** The surface cache's feedback (`createSurfaceFeedback`). */
export type SurfaceFeedback = ReturnType<typeof createSurfaceFeedback>
