import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { createGpuPeriodicReadback } from '../../gpu/core/periodicReadback.ts';

/** Pool words per tile a view starts with once its scene holds more lights than a list. */
const START_WORDS_PER_TILE = LIGHT_SETTINGS.tileLights / 4;
/** Pool words per tile the view grows to at most: its memory stays bounded by the view. */
const MOST_WORDS_PER_TILE = LIGHT_SETTINGS.tileLights * 4;
/** `TilePool` (`./compactWgsl.ts`): start, capacity, words reserved, overflow. */
const STATE_BYTES = 16;
/** Growth past what an overflowing frame reserved: a demand risen by less between samples fits. */
const HEADROOM = 1.25;

/**
 * The view's light-index pool, after the tile records in the same buffer (#849): a tile slice
 * past its list takes its room there. Its state is sampled one frame in fifteen, never waited
 * for: an overflow is named (`tileLightPoolOverflowed`) and grows the pool to `HEADROOM` times
 * what that frame reserved, within `MOST_WORDS_PER_TILE`. Until then, and past that bound, a tile with no room walks every light of the scene, exactly.
 */
export function createTileLightPool(device: GPUDevice) {
  const words = new Uint32Array(4);
  // What the last sampled frame asked of the pool, its fields moved together when it returns.
  const sample = { reserved: 0, capacity: 0, overflowed: false };
  let asked = 0;
  const reader = createGpuPeriodicReadback((mapped) => {
    const [, capacity, reserved, overflow] = new Uint32Array(mapped, 0, 4);
    sample.reserved = reserved;
    sample.capacity = capacity;
    sample.overflowed = overflow !== 0;
    if (sample.overflowed) asked = Math.max(asked, Math.ceil(reserved * HEADROOM));
  });
  reader.adopt(
    device.createBuffer({
      label: 'Trillion3D light tile pool readback',
      size: STATE_BYTES,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    }),
  );
  const state = device.createBuffer({
    label: 'Trillion3D light tile pool v1',
    size: STATE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  return {
    state,
    /** The last sample, or nothing until one has come back. */
    sample() {
      return reader.ready ? sample : undefined;
    },
    /** Pool words for `tiles` tiles of a scene that holds more lights than a list. */
    words(tiles: number) {
      return Math.min(Math.max(tiles * START_WORDS_PER_TILE, asked), tiles * MOST_WORDS_PER_TILE);
    },
    /** Opens the frame's pool at word `start`, `capacity` words: nothing reserved, no overflow. */
    open(start: number, capacity: number) {
      words[0] = start;
      words[1] = capacity;
      device.queue.writeBuffer(state, 0, words);
    },
    /** Encodes the copy of the state, after the pass that fills it, on a sampled frame. */
    sampleState(encoder: GPUCommandEncoder, frame: number) {
      if (!reader.due(frame)) return;
      reader.sampled(frame);
      reader.copy(encoder, state, 0, STATE_BYTES);
    },
    /** Requests mapping of the sample, once the frame that copied it is submitted. */
    submitted: reader.submitted,
    dispose() {
      state.destroy();
      reader.dispose();
    },
  };
}
