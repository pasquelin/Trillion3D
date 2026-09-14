import { HIZ_BOUNDS_VALUES, HIZ_TEST_VALUES, hizTestRectFlat } from './hiz.ts';

/** Reuse one typed buffer for the bounds tested in successive frames. */
export function createHizBoundsPacker() {
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
      const testable = hizTestRectFlat(bounds, at, width, height, sizes.length, rect);
      const level = testable ? rect[0] : 0,
        scale = 2 ** level;
      ints[base] = testable ? Math.floor(rect[1] / scale) : 0;
      ints[base + 1] = testable ? Math.floor(rect[2] / scale) : 0;
      ints[base + 2] = testable ? Math.floor(rect[3] / scale) : 0;
      ints[base + 3] = testable ? Math.floor(rect[4] / scale) : 0;
      floats[base + 4] = bounds[at + 4];
      words[base + 5] = ((rows[i] << 1) | (testable ? 0 : 1)) >>> 0;
      words[base + 6] = testable ? offsets[level] : 0;
      words[base + 7] = testable ? sizes[level][0] : width;
    }
    return bytes;
  };
}
