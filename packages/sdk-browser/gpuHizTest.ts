import { HIZ_BOUNDS_VALUES, HIZ_TEST_VALUES, hizTestRectFlat } from './hiz.ts';
import type { HizCountSample } from './gpuHizCounters.ts';

/** What the packer tells the counters about each box, in the same pass that packs it. */
export type HizBoxObserver = {
  observe(index: number, row: number, triangles: number, bounds: Float64Array): void;
};

/** Reuse one typed buffer for the bounds tested in successive frames. A `sample` handed to a call
 *  makes that call record every box into `counters` as it packs it, never in a second pass. */
export function createHizBoundsPacker(counters?: HizBoxObserver) {
  let bytes = new ArrayBuffer(32);
  let floats = new Float32Array(bytes);
  let ints = new Int32Array(bytes);
  let words = new Uint32Array(bytes);
  // The level and clipped rectangle of the box being written, reused by every box of every image.
  const rect = new Int32Array(HIZ_TEST_VALUES);
  return (
    bounds: Float64Array,
    rows: Uint32Array,
    count: number,
    width: number,
    height: number,
    sizes: Array<[number, number]>,
    offsets: number[],
    sample?: HizCountSample,
  ) => {
    const need = Math.max(32, count * 32);
    if (bytes.byteLength < need) {
      bytes = new ArrayBuffer(need);
      floats = new Float32Array(bytes);
      ints = new Int32Array(bytes);
      words = new Uint32Array(bytes);
    }
    for (let i = 0; i < count; i++) {
      const base = i * 8,
        at = i * HIZ_BOUNDS_VALUES;
      // The rectangle handed to the kernel is the one clipped to the viewport, in texels of the mip
      // that covers it exactly; `hizTestRectFlat` is the same call the CPU oracle makes, so the two
      // read the same texels of the same level.
      if (hizTestRectFlat(bounds, at, width, height, sizes.length, rect)) {
        const level = rect[0],
          scale = 2 ** level;
        ints[base] = Math.floor(rect[1] / scale);
        ints[base + 1] = Math.floor(rect[2] / scale);
        ints[base + 2] = Math.floor(rect[3] / scale);
        ints[base + 3] = Math.floor(rect[4] / scale);
        words[base + 5] = (rows[i] << 1) >>> 0;
        words[base + 6] = offsets[level];
        words[base + 7] = sizes[level][0];
      } else {
        ints[base] = ints[base + 1] = ints[base + 2] = ints[base + 3] = 0;
        words[base + 5] = ((rows[i] << 1) | 1) >>> 0;
        words[base + 6] = 0;
        words[base + 7] = width;
      }
      floats[base + 4] = bounds[at + 4];
      if (sample) counters!.observe(i, rows[i], sample.triangles[i] ?? 0, bounds);
    }
    return bytes;
  };
}
