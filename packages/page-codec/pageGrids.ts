/**
 * Grids and streams of the reference encoder: integer cells on a power-of-two grid, octahedral
 * normal bytes, and the bit packer that writes fixed-width fields, least significant bit first.
 */
const MAX_BITS = 24;
/** Corners per block of eight triangles, and the bits of a block's width. */
const BLOCK_CORNERS = 24,
  WIDTH_BITS = 5;

/** Bits that hold every value of `0..=range`, a range below 2^32; none for a constant field. */
export const bitsFor = (range: number) => (range <= 0 ? 0 : 32 - Math.clz32(range));

/** The finest grid exponent, never below `finest`, on which a `span` of values fits the field: at
 *  most 2^23 steps, which rounding at both ends keeps under the 2^24 a page holds. */
export const gridExponentFor = (span: number, finest: number) =>
  span > 0 ? Math.max(finest, Math.ceil(Math.log2(span)) - (MAX_BITS - 1)) : finest;

/** One attribute's cells on its grid: the bits and float minimum per component, the exponent
 *  that set the grid step, and the cells themselves (n components per vertex, row-major). */
export interface QuantizedGrid {
  min: number[];
  exponent: number;
  bits: number[];
  cells: number[];
}

/**
 * Integer cells of `n`-wide vectors on a power-of-two grid, and the record that describes them.
 * The exponent is the caller's, never widened: a page that needs more than 24 bits on it is
 * refused, as the format says (`PAGE_ATTRIBUTE_RANGE`).
 */
export function quantize(values: ArrayLike<number>, n: number, exponent: number): QuantizedGrid {
  const count = values.length / n,
    step = 2 ** exponent,
    lo = new Array<number>(n).fill(Infinity),
    hi = new Array<number>(n).fill(-Infinity),
    cells: number[] = [];
  for (let i = 0; i < count; i++)
    for (let c = 0; c < n; c++) {
      const cell = Math.round(values[i * n + c] / step);
      cells.push(cell);
      lo[c] = Math.min(lo[c], cell);
      hi[c] = Math.max(hi[c], cell);
    }
  const range = lo.map((low, c) => (count ? hi[c] - low : 0));
  if (range.some((r) => r >= 2 ** MAX_BITS)) throw new Error('PAGE_ATTRIBUTE_RANGE');
  const bits = range.map(bitsFor),
    min = lo.map((low) => (count ? Math.fround(low * step) : 0));
  for (let i = 0; i < cells.length; i++) cells[i] -= lo[i % n];
  return { min, exponent, bits, cells };
}

/** A displacement as the 32-bit float the header carries, rounded up so nothing exceeds it. */
export function ceil32(value: number): number {
  const float = new Float32Array([value]);
  if (float[0] < value) new Uint32Array(float.buffer)[0]++;
  return float[0];
}

/** Octahedral bytes of a normal, `x` low and `y` high; a zero normal takes `+z`. */
export function octEncode(x: number, y: number, z: number): number {
  const sum = Math.abs(x) + Math.abs(y) + Math.abs(z);
  if (!sum) return 128 | (128 << 8);
  let px = x / sum,
    py = y / sum;
  if (z < 0)
    [px, py] = [(1 - Math.abs(py)) * Math.sign(px || 1), (1 - Math.abs(px)) * Math.sign(py || 1)];
  const byte = (v: number) => Math.max(0, Math.min(255, Math.round((v + 1) * 127.5)));
  return byte(px) | (byte(py) << 8);
}

/** Bit streams, least significant bit first, each starting on a fresh word. */
export class Packer {
  words: number[] = [];
  bit = 0;
  push(value: number, bits: number) {
    if (!bits) return;
    const shift = this.bit % 32;
    if (!shift) this.words.push(0);
    this.words[this.words.length - 1] =
      (this.words[this.words.length - 1] | (value << shift)) >>> 0;
    if (shift + bits > 32) this.words.push(value >>> (32 - shift));
    this.bit += bits;
  }
  /** Pads the last word: the next field starts a new stream. */
  close() {
    this.bit = this.words.length * 32;
  }
  stream(values: readonly number[], bits: number) {
    for (const value of values) this.push(value, bits);
    this.close();
  }
}

/**
 * The corners by blocks of eight triangles: a table of records — the block's smallest corner, the
 * width of its corners' distances to it (five bits), the sum of the widths before it — then those
 * distances. Returns the corner stream's bit count, the header's word 21.
 */
export function packCorners(pack: Packer, corners: readonly number[], indexBits: number) {
  const blocks: { corners: number[]; base: number; width: number }[] = [];
  for (let i = 0; i < corners.length; i += BLOCK_CORNERS) {
    const block = corners.slice(i, i + BLOCK_CORNERS),
      base = Math.min(...block);
    blocks.push({ corners: block, base, width: bitsFor(Math.max(...block) - base) });
  }
  const cornerBits = blocks.reduce((sum, b) => sum + b.corners.length * b.width, 0),
    prefixBits = bitsFor(Math.floor(cornerBits / BLOCK_CORNERS));
  let prefix = 0;
  for (const { base, width } of blocks) {
    pack.push(base, indexBits);
    pack.push(width, WIDTH_BITS);
    pack.push(prefix, prefixBits);
    prefix += width;
  }
  pack.close();
  for (const { corners: block, base, width } of blocks)
    for (const corner of block) pack.push(corner - base, width);
  pack.close();
  return cornerBits;
}
