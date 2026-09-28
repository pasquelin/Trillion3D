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

const f = Math.fround;
/** The octahedron folded over its lower half, in 32-bit steps: `[x, y]` for `z < 0`. */
const fold = (x: number, y: number) => [
  f(f(1 - Math.abs(y)) * (x >= 0 ? 1 : -1)),
  f(f(1 - Math.abs(x)) * (y >= 0 ? 1 : -1)),
];

/** A normal's octahedral bytes back to a unit vector, in 32-bit steps as every reader does. */
function octDecode(q: number) {
  let x = f(f((q & 255) * f(2 / 255)) - 1),
    y = f(f(((q >>> 8) & 255) * f(2 / 255)) - 1);
  const z = f(f(1 - Math.abs(x)) - Math.abs(y));
  if (z < 0) [x, y] = fold(x, y);
  const length = f(Math.sqrt(f(f(f(x * x) + f(y * y)) + f(z * z))));
  return [f(x / length), f(y / length), f(z / length)];
}

/**
 * Octahedral bytes of a normal, `x` low and `y` high; a zero normal takes `+z`. Of the four
 * roundings of the projected point, the one that decodes closest to the normal is kept: the
 * "precise" variant the compiler writes (`oct_encode`, `geometry_page_quant.rs`), in the same
 * 32-bit steps, so a page cut at run time carries the normals the compiler's would.
 */
export function octEncode(x: number, y: number, z: number): number {
  [x, y, z] = [f(x), f(y), f(z)];
  const sum = f(f(Math.abs(x) + Math.abs(y)) + Math.abs(z));
  if (!sum || !Number.isFinite(sum)) return 128 | (128 << 8);
  let [px, py] = [f(x / sum), f(y / sum)];
  if (z < 0) [px, py] = fold(px, py);
  const cell = (v: number) => Math.min(254, Math.max(0, Math.floor(f(f(v + 1) * 127.5))));
  const [bx, by] = [cell(px), cell(py)];
  const length = f(Math.sqrt(f(f(f(x * x) + f(y * y)) + f(z * z))));
  const unit = [f(x / length), f(y / length), f(z / length)];
  let best = Infinity,
    chosen = 0;
  const candidates = [bx | (by << 8), bx | ((by + 1) << 8), (bx + 1) | (by << 8)];
  for (const candidate of [...candidates, (bx + 1) | ((by + 1) << 8)]) {
    const [dx, dy, dz] = octDecode(candidate);
    const error = f(1 - f(f(f(dx * unit[0]) + f(dy * unit[1])) + f(dz * unit[2])));
    if (error < best) [best, chosen] = [error, candidate];
  }
  return chosen;
}

/** Bit streams, least significant bit first, each starting on a fresh word. */
export class Packer {
  words: number[] = [];
  bit = 0;
  /** One `bits`-bit field, continuing the open word. */
  push(value: number, bits: number) {
    if (!bits) return;
    const shift = this.bit % 32;
    if (!shift) this.words.push(0);
    this.words[this.words.length - 1] =
      (this.words[this.words.length - 1] | (value << shift)) >>> 0;
    if (shift + bits > 32) this.words.push(value >>> (32 - shift));
    this.bit += bits;
  }
  /** Pads the last word written: the next field starts a new stream. */
  close() {
    this.bit = this.words.length * 32;
  }
  /** One whole stream: its fields, then the padding that closes the last word. */
  stream(values: readonly number[], bits: number) {
    for (const value of values) this.push(value, bits);
    this.close();
  }
  /**
   * The corners by blocks of eight triangles: a table of records — the block's smallest corner,
   * the width of its corners' distances to it (five bits), the sum of the widths before it — then
   * those distances, each stream closed. Returns the corner stream's bit count, word 21.
   */
  corners(corners: readonly number[], indexBits: number) {
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
      this.push(base, indexBits);
      this.push(width, WIDTH_BITS);
      this.push(prefix, prefixBits);
      prefix += width;
    }
    this.close();
    for (const { corners: block, base, width } of blocks)
      for (const corner of block) this.push(corner - base, width);
    this.close();
    return cornerBits;
  }
}
