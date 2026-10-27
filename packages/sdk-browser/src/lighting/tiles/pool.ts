import { createGpuPeriodicReadback } from '../../gpu/core/periodicReadback.ts'
import { log } from '../../diagnostic/log.ts'

/** `TilePool` (`./compactWgsl.ts`): start, capacity, entries asked, entries the lists hold. */
const STATE_BYTES = 16
/** Takes the state the pool's pass left: the sample, and the overflow said once per rise of the
 *  entries asked. */
function readPoolState(
  mapped: ArrayBuffer,
  sample: { reserved: number; capacity: number; overflowed: boolean },
  demand: { highWater: number },
  limited: boolean,
) {
  const [, capacity, asked, held] = new Uint32Array(mapped, 0, 4)
  sample.reserved = asked
  sample.capacity = capacity
  sample.overflowed = asked > held
  if (!sample.overflowed || asked <= demand.highWater) return
  demand.highWater = asked
  const cause = limited
    ? 'The device binds no larger buffer for them.'
    : 'Raise lightGridMaxCulledLightsPerCell to keep the lights it dropped.'
  log.warn(`The light grid overflowed: ${asked} light entries asked, ${held} held. ${cause}`)
}

/**
 * The light grid's light-index pool, after the cell records in the same buffer: each column of the
 * grid takes the room of its cells' lists there. Sampled one frame in fifteen, an overflow is named
 * (`tileLightPoolOverflowed`).
 *
 * The pool is FIXED: its cells (columns × `gridSlices`) times the setting
 * `lightGridMaxCulledLightsPerCell`: that many links, and as many list words. The entries asked
 * past it are dropped, a cell keeping the lights it got, in order; it overflowed when more were
 * asked than the lists hold, said once per rise of the entries asked. With the setting
 * `lightGridLinkedLists` off each cell has its words of its own in the pool and keeps its first
 * lights, the entries asked and held counted the same way.
 */
export function createTileLightPool(device: GPUDevice) {
  const words = new Uint32Array(STATE_BYTES / 4)
  // What the last sampled frame asked of the pool, its fields moved together when it returns.
  const sample = { reserved: 0, capacity: 0, overflowed: false }
  const demand = { highWater: 0 }
  // Whether the pool opened last was cut short by the device's limit on a buffer.
  let limited = false
  const reader = createGpuPeriodicReadback(
    device,
    { label: 'Trillion3D light tile pool readback', bytes: STATE_BYTES, eager: true },
    (mapped) => readPoolState(mapped, sample, demand, limited),
  )
  const state = device.createBuffer({
    label: 'Trillion3D light tile pool v1',
    size: STATE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  return {
    state,
    /** The last sample, or nothing until one has come back. */
    sample() {
      return reader.ready ? sample : undefined
    },
    /** Opens the frame's pool at word `start`, `capacity` words, `cut` when the device's limit on a
     *  buffer made it smaller than the setting asks: nothing asked, nothing held. */
    open(start: number, capacity: number, cut: boolean) {
      limited = cut
      words[0] = start
      words[1] = capacity
      device.queue.writeBuffer(state, 0, words)
    },
    /** Encodes the copy of the state, after the pass that fills it, on a sampled frame. */
    sampleState(encoder: GPUCommandEncoder, frame: number) {
      if (!reader.due(frame)) return
      if (reader.copy(encoder, state, 0, STATE_BYTES)) reader.sampled(frame)
    },
    /** Requests mapping of the sample, once the frame that copied it is submitted. */
    submitted: reader.submitted,
    dispose() {
      state.destroy()
      reader.dispose()
    },
  }
}
