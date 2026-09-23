import { BOUNCE_SETTINGS, type BounceCascades } from '../../../sdk-core/src/index.ts';

/** Four-byte words of a level in the uniform: two `vec4f`, origin and base cell. */
const LEVEL_WORDS = 8;
/** Header words: range and diagnostic view, cascade sizes, frame state. */
const HEADER_WORDS = 12;

/**
 * Bytes of `BounceGrid`, the single source of truth: this uniform, the WGSL struct the three
 * bounce shaders declare, and the substitute buffer a frame without bounce reads all have the
 * same size. An added cascade level grows it on all three sides at once, never on one —
 * a substitute smaller than the struct fails the binding, hence loses the device, and that
 * is exactly what a hand-written number has already cost.
 */
export const BOUNCE_GRID_BYTES = (HEADER_WORDS + BOUNCE_SETTINGS.cascadeLevels * LEVEL_WORDS) * 4;

/**
 * The uniform the three bounce shaders share: the probe pass, the surface-cache pass and
 * deferred resolve read the same cascade description, at the same slot.
 *
 * It is written once at construction for what never moves — range, sizes — and once per
 * encoded frame for what moves: the base cells of the levels that follow the camera, and
 * the batch each receives. Deferred resolve rereads it every frame, even when converged,
 * when no pass is encoded any more: that is why it is never zeroed.
 */
export function createBounceUniform(device: GPUDevice, cascades: BounceCascades) {
  // The uniform always carries the declared level count, even when the scene holds fewer:
  // the array size is a shader constant, and `counts.y` says how many are real.
  const packed = new ArrayBuffer(BOUNCE_GRID_BYTES);
  const floats = new Float32Array(packed),
    integers = new Uint32Array(packed);
  const buffer = device.createBuffer({
    label: 'WG bounce cascades v1',
    size: packed.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  floats[0] = cascades.reach;
  integers.set(
    [cascades.size, cascades.levels.length, cascades.probesPerLevel, cascades.probes],
    4,
  );
  const upload = () => device.queue.writeBuffer(buffer, 0, packed);
  upload();
  let view = false;
  return {
    buffer,
    bytes: packed.byteLength,
    /** Irradiance diagnostic view: it travels in the same uniform as the cascades. */
    setIrradianceView(on: boolean) {
      if (view === on) return;
      view = on;
      floats[1] = on ? 1 : 0;
      upload();
    },
    /** Encoded-frame state: light revision, dispatched groups, frame counter, levels. */
    write(generation: number, groups: number, frame: number) {
      integers[8] = generation;
      integers[9] = groups;
      integers[10] = frame;
      // Word by word: this write happens every encoded frame, and therefore allocates nothing.
      cascades.levels.forEach((level, index) => {
        const at = HEADER_WORDS + index * LEVEL_WORDS;
        floats[at + 3] = level.spacing;
        for (let axis = 0; axis < 3; axis++) {
          // `originSpacing.xyz`: world centre of the base cell. `base.xyz`: that cell.
          floats[at + axis] = (level.base[axis] + 0.5) * level.spacing;
          floats[at + 4 + axis] = level.base[axis];
        }
      });
      upload();
    },
    dispose() {
      buffer.destroy();
    },
  };
}
