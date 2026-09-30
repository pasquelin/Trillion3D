import { uniformStride } from '../../residency/pools.ts';
import { FRAME_VEC4 } from './types.ts';
import { primitiveWordAt } from './worlds.ts';
import { dagGroupEntries } from './shader/bindings.ts';
import { PRIMITIVE_BYTES, cameraFrameRanges } from './cameraRanges.ts';
/** Floats of one host row (`primitiveFrameWords`). */
const ROW_FLOATS = FRAME_VEC4 * 4;
/** Bytes of one primitive's world matrix in `worlds`. */
const WORLD_BYTES = 64;

/** Bytes of one range's `frames`; a range holds at least one primitive. */
export const framesBytes = (count: number) => count * PRIMITIVE_BYTES;

/** The `range` words of a `frames` that holds all `worldCount` primitives: a probe's. */
export const wholeRange = (worldCount: number) => new Uint32Array([0, worldCount, 0, 0]);

/**
 * A camera cut's `frames`, one buffer per range (`cameraFrameRanges`), and the uniform that tells
 * each bind group its range: `{first, count}` at the range's aligned offset, written once. A light
 * cut splits its own per-view rows in the same ranges and shares that uniform (`lightCut.ts`). The
 * host keeps its rows whole (`frameData`, indexed by primitive); each write lands in the range
 * that holds the primitive, at its row there. No work per frame: a write follows a change. The
 * world matrices follow the same ranges, one `worlds` buffer each, read at `rowOf(w)`.
 */
export function createCameraFrames(
  device: GPUDevice,
  frameData: Float32Array<ArrayBuffer>,
  worldCount: number,
  own: (descriptor: GPUBufferDescriptor) => GPUBuffer,
  worlds: Float32Array,
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
  const worldBuffers = ranges.map(({ count }) =>
    own({
      label: 'Trillion3D DAG worlds',
      size: count * WORLD_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
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
  /** Words written and not yet sent: one interval, in `frameInts` indices. */
  const pending = { from: Infinity, to: -1 };
  const table = {
    ranges,
    buffers,
    worldBuffers,
    /** Primitives of the largest range: what one binding of a light cut's rows must hold. */
    per,
    /** One bind group per range: `group`, its buffer of `targets`, its `worlds`, its `range`. */
    bindGroups(
      layout: GPUBindGroupLayout,
      group: Omit<Parameters<typeof dagGroupEntries>[0], 'frames' | 'worlds'>,
      targets = buffers,
    ) {
      return ranges.map(({ count }, r) => ({
        count,
        bindGroup: device.createBindGroup({
          layout,
          entries: dagGroupEntries(
            { ...group, frames: targets[r], worlds: worldBuffers[r] },
            { buffer: bounds, offset: r * stride, size: 16 },
          ),
        }),
      }));
    },
    /** Every host row, each to its range's buffer in `targets`, from its start. `dagPrepare`
     *  writes the rest. */
    writeRows(targets = buffers) {
      for (let r = 0; r < ranges.length; r++) {
        const { first, count } = ranges[r];
        device.queue.writeBuffer(targets[r], 0, frameData, first * ROW_FLOATS, count * ROW_FLOATS);
      }
    },
    /** Every primitive's world matrix in `next`, each to its range's `worlds`. */
    writeWorlds(next: Float32Array) {
      for (let r = 0; r < ranges.length; r++) {
        const { first, count } = ranges[r],
          bytes = Math.min(count * WORLD_BYTES, next.byteLength - first * WORLD_BYTES);
        if (bytes > 0)
          device.queue.writeBuffer(
            worldBuffers[r],
            0,
            next.buffer as ArrayBuffer,
            next.byteOffset + first * WORLD_BYTES,
            bytes,
          );
      }
    },
    /** Word `slot` of primitive `w`'s frame words, set in the host's row; its range receives it
     *  at the next `flushWords`, with every word written since, as one interval (CPU-15). */
    writeWord(w: number, slot: number, value: number) {
      const at = primitiveWordAt(w) + slot;
      frameInts[at] = value;
      if (at < pending.from) pending.from = at;
      if (at > pending.to) pending.to = at;
    },
    /**
     * The words written since the last flush, one write per range the interval crosses: the host
     * rows between them hold what their range already holds, or planes `dagPrepare` writes again
     * before any kernel reads them (`shader/shader.ts`). Nothing when no word was written.
     */
    flushWords() {
      const { from, to } = pending;
      if (to < from) return;
      pending.from = Infinity;
      pending.to = -1;
      for (let r = Math.floor(from / ROW_FLOATS / per); r < ranges.length; r++) {
        const start = ranges[r].first * ROW_FLOATS,
          end = start + ranges[r].count * ROW_FLOATS - 1;
        if (start > to) break;
        const a = Math.max(from, start),
          b = Math.min(to, end);
        device.queue.writeBuffer(buffers[r], (a - start) * 4, frameInts, a, b - a + 1);
      }
    },
    /** Every range's host rows into its buffer in `targets`, from its start: a light cut's. */
    copyRows(encoder: GPUCommandEncoder, targets: GPUBuffer[]) {
      for (let r = 0; r < ranges.length; r++)
        encoder.copyBufferToBuffer(buffers[r], 0, targets[r], 0, ranges[r].count * rowBytes);
    },
  };
  table.writeRows();
  table.writeWorlds(worlds);
  return table;
}
export type CameraFrames = ReturnType<typeof createCameraFrames>;
