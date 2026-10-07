import { clamp } from '../../math/src/scalar/reals.ts'
import { floorLog2 } from '../../math/src/scalar/integers.ts'
/**
 * Grids and streams of the reference encoder: integer cells on a power-of-two grid, octahedral
 * normal bytes, and the bit packer that writes fixed-width fields, least significant bit first.
 */
/** Bits of a page field: a component's cells span less than 2^MAX_BITS. */
export const MAX_BITS = 24
/** Corners per block of eight triangles, and the bits of a block's width. */
const BLOCK_CORNERS = 24,
  WIDTH_BITS = 5

/** Bits that hold every value of `0..=range`, a range below 2^32; none for a constant field. */
export const bitsFor = (range: number) => (range <= 0 ? 0 : floorLog2(range) + 1)

/** One attribute's cells on its grid: the bits and float minimum per component, the exponent
 *  that set the grid step, and the cells themselves (n components per vertex, row-major). */
export interface QuantizedGrid {
  min: number[]
  exponent: number
  bits: number[]
  cells: number[]
}

/** The nearest integer, a half away from zero, as Rust's `f64::round` the compiler's quantizer
 *  takes (`geometry_page_quant.rs`): `Math.round` sends −2.5 to −2, the compiler to −3, and a page
 *  cut at run time would then disagree with the one compiled. −0 stays −0, as in Rust. */
const roundHalfAway = (x: number) => (x < 0 ? -Math.round(-x) : Math.round(x))

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
    cells: number[] = []
  for (let i = 0; i < count; i++)
    for (let c = 0; c < n; c++) {
      const cell = roundHalfAway(values[i * n + c] / step)
      cells.push(cell)
      lo[c] = Math.min(lo[c], cell)
      hi[c] = Math.max(hi[c], cell)
    }
  const range = lo.map((low, c) => (count ? hi[c] - low : 0))
  if (range.some((r) => r >= 2 ** MAX_BITS)) throw new Error('PAGE_ATTRIBUTE_RANGE')
  const bits = range.map(bitsFor),
    min = lo.map((low) => (count ? Math.fround(low * step) : 0))
  for (let i = 0; i < cells.length; i++) cells[i] -= lo[i % n]
  return { min, exponent, bits, cells }
}

/** A displacement as the 32-bit float the header carries, rounded up so nothing exceeds it. */
export function ceil32(value: number): number {
  const float = new Float32Array([value])
  if (float[0] < value) new Uint32Array(float.buffer)[0]++
  return float[0]
}

const f = Math.fround,
  OCT_STEP = f(2 / 255)

/** A grid value back to its float, `min + q * step` in 32-bit steps, the product exact and the sum
 *  rounded once: the one every reader decodes with (`dequant`, `bits/quant.rs`). */
export const dequant = (min: number, q: number, step: number) => f(min + f(q * step))

/** A normal's octahedral bytes (`x` low, `y` high) back to a unit vector at `out[at..at + 3]`, in
 *  32-bit steps: the one decoder the reader and the encoder below share. */
export function octDecode(q: number, out: { [i: number]: number }, at = 0) {
  let x = f(f((q & 255) * OCT_STEP) - 1),
    y = f(f(((q >>> 8) & 255) * OCT_STEP) - 1)
  const z = f(f(1 - Math.abs(x)) - Math.abs(y))
  if (z < 0) {
    const fx = f(f(1 - Math.abs(y)) * (x >= 0 ? 1 : -1))
    y = f(f(1 - Math.abs(x)) * (y >= 0 ? 1 : -1))
    x = fx
  }
  const length = f(Math.sqrt(f(f(f(x * x) + f(y * y)) + f(z * z))))
  out[at] = f(x / length)
  out[at + 1] = f(y / length)
  out[at + 2] = f(z / length)
}

const decoded = new Float32Array(3)
/**
 * Octahedral bytes of a normal, `x` low and `y` high; a zero normal takes `+z`. Of the four
 * roundings of the projected point, the one that decodes closest to the normal is kept: the
 * "precise" variant the compiler writes (`oct_encode`, `geometry_page_quant.rs`), in the same
 * 32-bit steps, so a page cut at run time carries the normals the compiler's would.
 */
export function octEncode(x: number, y: number, z: number): number {
  x = f(x)
  y = f(y)
  z = f(z)
  const sum = f(f(Math.abs(x) + Math.abs(y)) + Math.abs(z))
  if (!sum || !Number.isFinite(sum)) return 128 | (128 << 8)
  let px = f(x / sum),
    py = f(y / sum)
  if (z < 0) {
    const fx = f(f(1 - Math.abs(py)) * (px >= 0 ? 1 : -1))
    py = f(f(1 - Math.abs(px)) * (py >= 0 ? 1 : -1))
    px = fx
  }
  const cell = (v: number) => clamp(Math.floor(f(f(v + 1) * 127.5)), 0, 254)
  const bx = cell(px),
    by = cell(py),
    length = f(Math.sqrt(f(f(f(x * x) + f(y * y)) + f(z * z)))),
    ux = f(x / length),
    uy = f(y / length),
    uz = f(z / length)
  let best = Infinity,
    chosen = 0
  // The compiler's order, `x` outer: a tie keeps the same code.
  for (let dx = 0; dx < 2; dx++)
    for (let dy = 0; dy < 2; dy++) {
      const candidate = (bx + dx) | ((by + dy) << 8)
      octDecode(candidate, decoded)
      const error = f(1 - f(f(f(decoded[0] * ux) + f(decoded[1] * uy)) + f(decoded[2] * uz)))
      if (error < best) {
        best = error
        chosen = candidate
      }
    }
  return chosen
}

/** Bit streams, least significant bit first, each starting on a fresh word. */
export class Packer {
  words: number[] = []
  bit = 0
  /** One `bits`-bit field, continuing the open word. */
  push(value: number, bits: number) {
    if (!bits) return
    const shift = this.bit % 32
    if (!shift) this.words.push(0)
    this.words[this.words.length - 1] = (this.words[this.words.length - 1] | (value << shift)) >>> 0
    if (shift + bits > 32) this.words.push(value >>> (32 - shift))
    this.bit += bits
  }
  /** Pads the last word written: the next field starts a new stream. */
  close() {
    this.bit = this.words.length * 32
  }
  /** One whole stream: its fields, then the padding that closes the last word. */
  stream(values: readonly number[], bits: number) {
    for (const value of values) this.push(value, bits)
    this.close()
  }
  /**
   * The corners by blocks of eight triangles: a table of records — the block's smallest corner,
   * the width of its corners' distances to it (five bits), the sum of the widths before it — then
   * those distances, each stream closed. Returns the corner stream's bit count, word 21.
   */
  corners(corners: readonly number[], indexBits: number) {
    const blocks: { corners: number[]; base: number; width: number }[] = []
    for (let i = 0; i < corners.length; i += BLOCK_CORNERS) {
      const block = corners.slice(i, i + BLOCK_CORNERS),
        base = Math.min(...block)
      blocks.push({ corners: block, base, width: bitsFor(Math.max(...block) - base) })
    }
    const cornerBits = blocks.reduce((sum, b) => sum + b.corners.length * b.width, 0),
      prefixBits = bitsFor(Math.floor(cornerBits / BLOCK_CORNERS))
    let prefix = 0
    for (const { base, width } of blocks) {
      this.push(base, indexBits)
      this.push(width, WIDTH_BITS)
      this.push(prefix, prefixBits)
      prefix += width
    }
    this.close()
    for (const { corners: block, base, width } of blocks)
      for (const corner of block) this.push(corner - base, width)
    this.close()
    return cornerBits
  }
}
