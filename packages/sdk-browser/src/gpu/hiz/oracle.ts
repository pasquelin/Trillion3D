import { hizBuildPyramid, hizReduceCeil } from '../../../../sdk-core/src/index.ts';
import { hizRejects, type HizBounds, type HizPyramid } from '../../hiz/hiz.ts';
import { VERDICT_KEPT, VERDICT_REJECTED } from '../partition/contract.ts';

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

/** A packed pyramid's mip sizes, each mip's first texel and its whole size in bytes. */
export function pyramidBytes(width: number, height: number) {
  const sizes = hizLevelSizes(width, height);
  const offsets: number[] = [];
  let texels = 0;
  for (const [w, h] of sizes) {
    offsets.push(texels);
    texels += w * h;
  }
  return { sizes, offsets, texels, bytes: Math.max(4, texels * 4) };
}

function rowsOf(data: Float32Array, width: number, height: number) {
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row = new Array<number>(width);
    for (let x = 0; x < width; x++) row[x] = data[y * width + x];
    rows.push(row);
  }
  return rows;
}

/** Pack level-0 rows into the full ceil-max pyramid used by the GPU kernel. */
export function packHizPyramid(level0: readonly (readonly number[])[]): PackedHiz {
  const levels = hizBuildPyramid(level0);
  const { sizes, offsets, texels } = pyramidBytes(level0[0].length, level0.length);
  const data = new Float32Array(texels);
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i],
      [w] = sizes[i],
      base = offsets[i];
    for (let y = 0; y < level.length; y++) data.set(level[y], base + y * w);
  }
  return { data, sizes, offsets };
}

/** One ceil-2×2 min reduction of a packed level: the farthest of each square, the engine's depth
 *  being reversed. */
export function evaluateHizReduce(src: Float32Array, srcWidth: number, srcHeight: number) {
  const reduced = hizReduceCeil(rowsOf(src, srcWidth, srcHeight));
  const height = reduced.length,
    width = height ? reduced[0].length : 0;
  const data = new Float32Array(Math.max(1, width * height));
  for (let y = 0; y < height; y++) data.set(reduced[y], y * width);
  return { data, width, height };
}

/** The GPU kernel's pack is already flat: the CPU test's pyramid reads it without copying it. */
function pyramidFromPacked(packed: PackedHiz): HizPyramid {
  return {
    data: packed.data,
    offsets: Int32Array.from(packed.offsets),
    widths: Int32Array.from(packed.sizes, ([w]) => w),
    heights: Int32Array.from(packed.sizes, ([, h]) => h),
    count: packed.sizes.length,
  };
}

/** Same rejection as `hizRejects` (mip-selected inclusive footprint, near clips never hide). */
export function evaluateHizTest(packed: PackedHiz, bounds: HizBounds[], bias = 0) {
  const pyramid = pyramidFromPacked(packed);
  const flags = new Uint32Array(bounds.length);
  for (let i = 0; i < bounds.length; i++)
    flags[i] = hizRejects(pyramid, bounds[i], bias) ? VERDICT_REJECTED : VERDICT_KEPT;
  return flags;
}
