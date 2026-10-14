/**
 * THE TRANSLUCENT CASTERS' TRANSMISSION AS MADE (`transmissionPass.ts`): its slice table, block
 * pool, links, build buffer, indirect arguments, frame uniform and readable memory, for one VSM
 * resource set, and the counters a frame reads back late, which ask larger capacities.
 */
import { arrayView } from '../gpu/core/textureViews.ts'
import { createReadbackRing } from '../gpu/core/readbackRing.ts'
import { NO_INDEX } from '../../../math/src/constants.ts'
import type { VsmLayout } from './layout.ts'
import { vsmRenderStorage } from './chunkLists.ts'
import {
  headerRows,
  VSM_TRANSMISSION_ARGS_WORDS,
  VSM_TRANSMISSION_COUNTERS,
  VSM_TRANSMISSION_FEEDBACK_BYTES,
  VSM_TRANSMISSION_UNIFORM_BYTES,
  VSM_TRANSMISSION_WIDTH,
  vsmTransmissionBytes,
  vsmTransmissionFirstCaps,
  vsmTransmissionMemoryDescriptor,
  vsmTransmissionRegions,
  type VsmTransmissionCaps,
} from './transmissionLayout.ts'
import { vsmTransmissionWanted } from './transmissionCaps.ts'
import type { VsmTransmissionContext } from './transmissionContext.ts'
import { VSM_PASS_PREFIX } from '../stage/passLabels.ts'

/** What the transmission's pass, pipes and buffers are labelled under. */
export const TRANSMISSION_LABEL = `${VSM_PASS_PREFIX}transmission`

/** The tables, the build buffer and the readable memory, made for one VSM resource set. */
export interface VsmTransmission {
  layout: VsmLayout
  caps: VsmTransmissionCaps
  /** Page × slice → first block (none: `NO_INDEX`), persistent. */
  table: GPUBuffer
  /** [free count, spare, free blocks…]. */
  pool: GPUBuffer
  /** Each block's next in its slice's chain. */
  links: GPUBuffer
  /** Counters, each slice's stamp, first place and counts, the frame's slices, the dirty list, the
   *  order, records and patches (`vsmTransmissionRegions`). */
  build: GPUBuffer
  /** The indirect dispatches the GPU writes (`VSM_TRANSMISSION_ARGS_WORDS`). */
  args: GPUBuffer
  uniform: GPUBuffer
  memory: GPUTexture
  /** The read view (2-D array of one layer, uint), what the consumers bind. */
  view: GPUTextureView
  storageView: GPUTextureView
  /** The capacities a frame wanted past these (read back late): the owner grows to them. Never once
   *  `capped`: no frame waits for a growth that will not come (`vsmUnsettled`). */
  wanted?: VsmTransmissionCaps
  /** Slices a frame found past the longest chain, as last read: drawn uncoloured. */
  full: number
  /** True once the GPU budget or the device held no larger capacities. */
  capped: boolean
  /** Copies the counters out after the frame's submit. */
  readFeedback(encoder: GPUCommandEncoder): void
  afterSubmit(): void
  /** Every byte it asked the device for (`vsmTransmissionBytes`). */
  bytes: number
  /** Its draw context (`context`), which a grown transmission keeps (`grownFrom`): freed by
   *  `releaseVsmTransmission`. */
  context?: VsmTransmissionContext
  destroy(): void
}

/** The transmission's buffers for `caps`: its slice table, every slice none; its block pool, every
 *  block free; the links, the build, the indirect arguments and the frame's uniform. */
function transmissionBuffers(device: GPUDevice, pages: number, caps: VsmTransmissionCaps) {
  const storage = (label: string, bytes: number, extra = 0) =>
    device.createBuffer({
      label: `${TRANSMISSION_LABEL}.${label}`,
      size: bytes,
      usage: vsmRenderStorage() | extra,
    })
  // Two slices a physical page: dynamic, static.
  const table = storage('table', 2 * pages * 4)
  device.queue.writeBuffer(table, 0, new Uint32Array(2 * pages).fill(NO_INDEX))
  const pool = storage('pool', (caps.blocks + 2) * 4)
  const free = new Uint32Array(caps.blocks + 2)
  free[0] = caps.blocks
  for (let k = 0; k < caps.blocks; k++) free[2 + k] = caps.blocks - 1 - k
  device.queue.writeBuffer(pool, 0, free)
  const links = storage('links', caps.blocks * 4)
  const build = storage(
    'build',
    vsmTransmissionRegions(pages, caps).words * 4,
    GPUBufferUsage.COPY_SRC,
  )
  const args = device.createBuffer({
    label: `${TRANSMISSION_LABEL}.args`,
    size: VSM_TRANSMISSION_ARGS_WORDS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
  })
  const uniform = device.createBuffer({
    label: `${TRANSMISSION_LABEL}.frame`,
    size: VSM_TRANSMISSION_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  return { table, pool, links, build, args, uniform }
}

/** The transmission's memory of `blocks` blocks for `layout`, every page header none: a page no
 *  slice was resolved for reads no block. */
function transmissionMemory(device: GPUDevice, layout: VsmLayout, blocks: number) {
  const memory = device.createTexture(
    vsmTransmissionMemoryDescriptor(
      layout,
      blocks,
      GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    ),
  )
  const rows = headerRows(layout.poolPages)
  device.queue.writeTexture(
    { texture: memory },
    new Uint32Array(4 * VSM_TRANSMISSION_WIDTH * rows).fill(NO_INDEX),
    { bytesPerRow: 16 * VSM_TRANSMISSION_WIDTH, rowsPerImage: rows },
    [VSM_TRANSMISSION_WIDTH, rows],
  )
  return memory
}

/** Takes the counters a frame read back into `trans`: the blocks it lacked, and the capacities
 *  that would have held it, unless it is capped. */
function takeCounters(trans: VsmTransmission, mapped: ArrayBuffer) {
  const counters = new Uint32Array(mapped)
  trans.full = counters[VSM_TRANSMISSION_COUNTERS.full]
  if (trans.capped) return
  const wanted = vsmTransmissionWanted(trans.wanted ?? trans.caps, counters)
  if (wanted) trans.wanted = wanted
}

/** The transmission of `caps` for `layout`; one `grownFrom` a smaller one of that layout keeps
 *  its draw context, which depends on the layout alone. */
export function createVsmTransmission(
  device: GPUDevice,
  layout: VsmLayout,
  caps = vsmTransmissionFirstCaps(layout.poolPages),
  grownFrom?: VsmTransmission,
): VsmTransmission {
  const buffers = transmissionBuffers(device, layout.poolPages, caps),
    { build } = buffers
  const memory = transmissionMemory(device, layout, caps.blocks)
  // The counters, read back a few frames late.
  const feedback = createReadbackRing(
    device,
    {
      label: `${TRANSMISSION_LABEL}.feedback`,
      bytes: VSM_TRANSMISSION_FEEDBACK_BYTES,
      count: 2,
      eager: true,
    },
    (mapped) => takeCounters(trans, mapped),
  )
  const trans: VsmTransmission = {
    layout,
    caps,
    ...buffers,
    memory,
    view: arrayView(memory),
    storageView: memory.createView({ dimension: '2d' }),
    full: 0,
    capped: false,
    readFeedback(encoder) {
      // A copy whose frame was never submitted is still pending: this frame's copy reuses it.
      const buffer = feedback.take()
      if (buffer) encoder.copyBufferToBuffer(build, 0, buffer, 0, VSM_TRANSMISSION_FEEDBACK_BYTES)
    },
    afterSubmit: feedback.submitted,
    bytes: vsmTransmissionBytes(layout, caps),
    destroy() {
      feedback.destroy()
      for (const buffer of Object.values(buffers)) buffer.destroy()
      memory.destroy()
    },
    context: grownFrom?.context,
  }
  return trans
}
