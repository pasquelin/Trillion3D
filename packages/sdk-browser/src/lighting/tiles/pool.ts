import { createGpuPeriodicReadback } from '../../gpu/core/periodicReadback.ts'
import { log } from '../../diagnostic/log.ts'

/** `TilePool` (`./compactWgsl.ts`): start, capacity, words reserved, overflow. */
const STATE_BYTES = 16
/** Takes the state the pool's pass left: the sample, and the overflow said once per rise of its demand. */
function readPoolState(
  mapped: ArrayBuffer,
  sample: { reserved: number; capacity: number; overflowed: boolean },
  demand: { highWater: number },
) {
  const [, capacity, reserved, overflow] = new Uint32Array(mapped, 0, 4)
  sample.reserved = reserved
  sample.capacity = capacity
  sample.overflowed = overflow !== 0
  if (!sample.overflowed) return
  if (reserved > demand.highWater) {
    demand.highWater = reserved
    log.warn(
      `The light grid overflowed: ${reserved} light entries asked, ${capacity} held. ` +
        'Raise lightGridMaxCulledLightsPerCell to keep the lights it dropped.',
    )
  }
}

/**
 * The light grid's light-index pool, after the cell records in the same buffer: each column of the
 * grid takes the room of its cells' lists there. Sampled one frame in fifteen, an overflow is named
 * (`tileLightPoolOverflowed`).
 *
 * The pool is FIXED: its cells (columns × `gridSlices`) times the setting
 * `lightGridMaxCulledLightsPerCell`, as the reference's global limit of light links; a column past
 * it keeps the lights it got, in order, and drops the rest, and the overflow is said once per rise
 * of its demand.
 */
export function createTileLightPool(device: GPUDevice) {
  const words = new Uint32Array(4)
  // What the last sampled frame asked of the pool, its fields moved together when it returns.
  const sample = { reserved: 0, capacity: 0, overflowed: false }
  const demand = { highWater: 0 }
  const reader = createGpuPeriodicReadback(
    device,
    { label: 'Trillion3D light tile pool readback', bytes: STATE_BYTES, eager: true },
    (mapped) => readPoolState(mapped, sample, demand),
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
    /** Opens the frame's pool at word `start`, `capacity` words: nothing reserved, no overflow. */
    open(start: number, capacity: number) {
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
