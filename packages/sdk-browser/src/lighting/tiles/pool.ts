import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts'
import { createGpuPeriodicReadback } from '../../gpu/core/periodicReadback.ts'

/** Pool words per column of the light grid a view starts with: `tileLights` lights over sixteen of
 *  its slices, a run of a lamp across a doubling of the view depth. */
const START_WORDS_PER_TILE = LIGHT_SETTINGS.tileLights * 16
/** Pool words per column the view grows to at most: its memory stays bounded by the view. */
const MOST_WORDS_PER_TILE = START_WORDS_PER_TILE * 16

/** `TilePool` (`./compactWgsl.ts`): start, capacity, words reserved, overflow. */
const STATE_BYTES = 16
/** Growth past what an overflowing frame reserved: a demand risen by less between samples fits. */
const HEADROOM = 1.25

/**
 * The view's light-index pool, after the cell records in the same buffer (#849, #1369): each column
 * of the light grid takes the room of its cells' lists there. Sampled one frame in fifteen, an
 * overflow is named (`tileLightPoolOverflowed`) and grows the pool to `HEADROOM` times what it
 * reserved, within `MOST_WORDS_PER_TILE`; until then, and past it, a column with no room walks
 * every light exactly.
 */
export function createTileLightPool(device: GPUDevice) {
  const words = new Uint32Array(4)
  // What the last sampled frame asked of the pool, its fields moved together when it returns.
  const sample = { reserved: 0, capacity: 0, overflowed: false }
  let asked = 0
  const reader = createGpuPeriodicReadback((mapped) => {
    const [, capacity, reserved, overflow] = new Uint32Array(mapped, 0, 4)
    sample.reserved = reserved
    sample.capacity = capacity
    sample.overflowed = overflow !== 0
    if (sample.overflowed) asked = Math.max(asked, Math.ceil(reserved * HEADROOM))
  })
  reader.adopt(
    device.createBuffer({
      label: 'Trillion3D light tile pool readback',
      size: STATE_BYTES,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    }),
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
    /**
     * Pool words for `tiles` columns of the light grid over `lights` lights. A column lists each
     * light at most once in each of its `gridSlices` slices (`./compactWgsl.ts`): `gridSlices ×
     * lights` words hold its lists whole, so a view starts at that bound when it is below
     * `START_WORDS_PER_TILE`, and no column of it ever overflows.
     */
    words(tiles: number, lights: number) {
      const start = Math.min(START_WORDS_PER_TILE, LIGHT_SETTINGS.gridSlices * Math.max(1, lights))
      return Math.min(Math.max(tiles * start, asked), tiles * MOST_WORDS_PER_TILE)
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
      reader.sampled(frame)
      reader.copy(encoder, state, 0, STATE_BYTES)
    },
    /** Requests mapping of the sample, once the frame that copied it is submitted. */
    submitted: reader.submitted,
    dispose() {
      state.destroy()
      reader.dispose()
    },
  }
}
