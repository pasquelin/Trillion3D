import { hizBuildPyramid, hizReduceCeil } from '../sdk-core/index.ts';
import { hizRejects, type HizBounds, type HizPyramid } from './hiz.ts';

export type PackedHiz = { data: Float32Array; sizes: Array<[number, number]>; offsets: number[] };

export function hizLevelSizes(width: number, height: number): Array<[number, number]> {
  if (width < 1 || height < 1) throw new Error('HIZ_DEPTH_SIZE');
  const sizes: Array<[number, number]> = [[width, height]];
  while (sizes[sizes.length - 1][0] > 1 || sizes[sizes.length - 1][1] > 1) {
    const [w, h] = sizes[sizes.length - 1];
    sizes.push([Math.ceil(w / 2), Math.ceil(h / 2)]);
  }
  return sizes;
}

function rowsOf(data: Float32Array, width: number, height: number, offset = 0) {
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row = new Array<number>(width);
    for (let x = 0; x < width; x++) row[x] = data[offset + y * width + x];
    rows.push(row);
  }
  return rows;
}

/** Pack level-0 rows into the full ceil-max pyramid used by the GPU kernel. */
export function packHizPyramid(level0: readonly (readonly number[])[]): PackedHiz {
  const levels = hizBuildPyramid(level0);
  const sizes = levels.map((level) => [level[0].length, level.length] as [number, number]);
  const offsets: number[] = [];
  let total = 0;
  for (const [w, h] of sizes) {
    offsets.push(total);
    total += w * h;
  }
  const data = new Float32Array(Math.max(1, total));
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i],
      [w] = sizes[i],
      base = offsets[i];
    for (let y = 0; y < level.length; y++) data.set(level[y], base + y * w);
  }
  return { data, sizes, offsets };
}

/** One ceil-2×2 max reduction of a packed level (background 1). */
export function evaluateHizReduce(src: Float32Array, srcWidth: number, srcHeight: number) {
  const reduced = hizReduceCeil(rowsOf(src, srcWidth, srcHeight));
  const height = reduced.length,
    width = height ? reduced[0].length : 0;
  const data = new Float32Array(Math.max(1, width * height));
  for (let y = 0; y < height; y++) data.set(reduced[y], y * width);
  return { data, width, height };
}

function pyramidFromPacked(packed: PackedHiz): HizPyramid {
  const levels = packed.sizes.map(([w, h], i) => rowsOf(packed.data, w, h, packed.offsets[i]));
  return { levels, width: packed.sizes[0][0], height: packed.sizes[0][1] };
}

/** Same rejection as `hizRejects` (mip-selected inclusive footprint, near clips never hide). */
export function evaluateHizTest(packed: PackedHiz, bounds: HizBounds[], bias = 0) {
  const pyramid = pyramidFromPacked(packed);
  const flags = new Uint32Array(bounds.length);
  for (let i = 0; i < bounds.length; i++) flags[i] = hizRejects(pyramid, bounds[i], bias) ? 1 : 0;
  return flags;
}
