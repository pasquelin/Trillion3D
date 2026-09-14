import { HIZ_BOUNDS_VALUES, hizFootprintLevelFlat } from './hiz.ts';

/** Reuse one typed buffer for the bounds tested in successive frames. */
export function createHizBoundsPacker() {
  let bytes = new ArrayBuffer(32);
  let floats = new Float32Array(bytes);
  let ints = new Int32Array(bytes);
  let words = new Uint32Array(bytes);
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
      const level = hizFootprintLevelFlat(bounds, at, width, height, sizes.length);
      const scale = level === undefined ? 1 : 2 ** level;
      ints[base] = Math.floor(bounds[at] / scale);
      ints[base + 1] = Math.floor(bounds[at + 1] / scale);
      ints[base + 2] = Math.floor(bounds[at + 2] / scale);
      ints[base + 3] = Math.floor(bounds[at + 3] / scale);
      floats[base + 4] = bounds[at + 4];
      words[base + 5] = ((rows[i] << 1) | (level === undefined ? 1 : 0)) >>> 0;
      words[base + 6] = level === undefined ? 0 : offsets[level];
      words[base + 7] = level === undefined ? width : sizes[level][0];
    }
    return bytes;
  };
}
