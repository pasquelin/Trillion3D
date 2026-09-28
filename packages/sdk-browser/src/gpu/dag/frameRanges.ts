import { storageBufferCap, uniformStride } from '../../residency/pools.ts';
import { FRAME_VEC4, PRIMITIVE_VEC4 } from './types.ts';
import { primitiveWordAt } from './worlds.ts';

/** Bytes one primitive holds in a camera cut's `frames`: the host's row, then what `dagPrepare`
 *  derives (`shader/primitiveWgsl.ts`), which the host never writes. */
const PRIMITIVE_BYTES = (FRAME_VEC4 + PRIMITIVE_VEC4) * 16;
/** Floats of one host row (`primitiveFrameWords`). */
const ROW_FLOATS = FRAME_VEC4 * 4;

/** Bytes of one range's `frames`. Never under 16: a range without primitives still binds a valid
 *  storage buffer. */
export const framesBytes = (count: number) => Math.max(16, count * PRIMITIVE_BYTES);

/**
 * THE RANGES A CAMERA CUT'S `frames` IS SPLIT IN on this device. Each primitive holds
 * `PRIMITIVE_BYTES`, and one storage buffer holds and binds at most `storageBufferCap` bytes: past
 * it, one table could be neither created nor bound, and the scene would not draw. So the table is
 * cut into ranges of as many primitives as one buffer holds, each its own buffer and bind group,
 * and the kernels that read a primitive's words run once per range, each on the primitives of its
 * range (`encode.ts`). A scene the device holds whole is one range: the layout, the kernels
 * (`SPLIT`, `shader/viewsWgsl.ts`) and the dispatches of before.
 */
export function cameraFrameRanges(
  limits: Parameters<typeof storageBufferCap>[0],
  worldCount: number,
) {
  const per = Math.max(1, Math.floor(storageBufferCap(limits) / PRIMITIVE_BYTES));
  const ranges: { first: number; count: number }[] = [];
  for (let first = 0; first < worldCount; first += per)
    ranges.push({ first, count: Math.min(per, worldCount - first) });
  return ranges;
}

/** The `range` words of a `frames` that holds all `worldCount` primitives: a probe's. */
export const wholeRange = (worldCount: number) => new Uint32Array([0, worldCount, 0, 0]);

/**
 * A camera cut's `frames`, one buffer per range (`cameraFrameRanges`), and the uniform that tells
 * each bind group its range: `{first, count}` at the range's aligned offset, written once. A light
 * cut splits its own per-view rows in the same ranges and shares that uniform (`lightCut.ts`). The
 * host keeps its rows whole (`frameData`, indexed by primitive); each write lands in the range
 * that holds the primitive, at its row there. No work per frame: a write follows a change.
 */
export function createCameraFrames(
  device: GPUDevice,
  frameData: Float32Array<ArrayBuffer>,
  worldCount: number,
  own: (descriptor: GPUBufferDescriptor) => GPUBuffer,
) {
  const ranges = cameraFrameRanges(device.limits, worldCount),
    stride = uniformStride(device.limits),
    per = ranges[0].count,
    rowBytes = ROW_FLOATS * 4;
  const buffers = ranges.map(({ count }) =>
    own({
      label: 'Trillion3D DAG frames',
      size: framesBytes(count),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    }),
  );
  const bounds = own({
    label: 'Trillion3D DAG frame ranges',
    size: ranges.length * stride,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const words = new Uint32Array((ranges.length * stride) / 4);
  for (let r = 0; r < ranges.length; r++)
    words.set([ranges[r].first, ranges[r].count], (r * stride) / 4);
  device.queue.writeBuffer(bounds, 0, words);
  const frameInts = new Uint32Array(frameData.buffer, frameData.byteOffset, frameData.length);
  const table = {
    ranges,
    buffers,
    /** Primitives of the largest range: what one binding of a light cut's rows must hold. */
    per,
    /** What each range's bind group binds as `range`. */
    rangeBindings: ranges.map((_, r) => ({ buffer: bounds, offset: r * stride, size: 16 })),
    /** Every host row, each to its range's buffer in `targets`, from its start. `dagPrepare`
     *  writes the rest. */
    writeRows(targets = buffers) {
      for (let r = 0; r < ranges.length; r++) {
        const { first, count } = ranges[r];
        device.queue.writeBuffer(targets[r], 0, frameData, first * ROW_FLOATS, count * ROW_FLOATS);
      }
    },
    /** Word `slot` of primitive `w`'s frame words, set in the host's row and in its range. */
    writeWord(w: number, slot: number, value: number) {
      const r = Math.floor(w / per),
        at = primitiveWordAt(w) + slot;
      frameInts[at] = value;
      const offset = (at - ranges[r].first * ROW_FLOATS) * 4;
      device.queue.writeBuffer(buffers[r], offset, frameInts, at, 1);
    },
    /** Every range's host rows into its buffer in `targets`, from its start: a light cut's. */
    copyRows(encoder: GPUCommandEncoder, targets: GPUBuffer[]) {
      for (let r = 0; r < ranges.length; r++)
        encoder.copyBufferToBuffer(buffers[r], 0, targets[r], 0, ranges[r].count * rowBytes);
    },
  };
  table.writeRows();
  return table;
}
export type CameraFrames = ReturnType<typeof createCameraFrames>;
