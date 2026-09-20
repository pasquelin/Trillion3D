/**
 * Grids and streams of the reference encoder: integer cells on a power-of-two grid, octahedral
 * normal bytes, and the bit packer that writes fixed-width fields, least significant bit first.
 */
const MAX_BITS = 24;

export const bitsFor = (range) => (range <= 0 ? 0 : Math.floor(Math.log2(range)) + 1);

/** Integer cells of `n`-wide vectors on a power-of-two grid, and the record that describes them. */
export function quantize(values, n, exponent) {
  const count = values.length / n;
  for (;;) {
    const step = 2 ** exponent,
      lo = new Array(n).fill(Infinity),
      hi = new Array(n).fill(-Infinity),
      cells = [];
    for (let i = 0; i < count; i++)
      for (let c = 0; c < n; c++) {
        const cell = Math.round(values[i * n + c] / step);
        cells.push(cell);
        lo[c] = Math.min(lo[c], cell);
        hi[c] = Math.max(hi[c], cell);
      }
    const bits = lo.map((low, c) => (count ? bitsFor(hi[c] - low) : 0));
    if (bits.some((b) => b > MAX_BITS)) {
      if (exponent >= 64) throw new Error('PAGE_ATTRIBUTE_RANGE');
      exponent++;
      continue;
    }
    const min = lo.map((low) => (count ? Math.fround(low * step) : 0));
    for (let i = 0; i < cells.length; i++) cells[i] -= lo[i % n];
    return { min, exponent, bits, cells };
  }
}

/** Octahedral bytes of a normal, `x` low and `y` high; a zero normal takes `+z`. */
export function octEncode(x, y, z) {
  const sum = Math.abs(x) + Math.abs(y) + Math.abs(z);
  if (!sum) return 128 | (128 << 8);
  let px = x / sum,
    py = y / sum;
  if (z < 0)
    [px, py] = [(1 - Math.abs(py)) * Math.sign(px || 1), (1 - Math.abs(px)) * Math.sign(py || 1)];
  const byte = (v) => Math.max(0, Math.min(255, Math.round((v + 1) * 127.5)));
  return byte(px) | (byte(py) << 8);
}

/** Bit streams, least significant bit first, each starting on a fresh word. */
export class Packer {
  words = [];
  bit = 0;
  stream(values, bits) {
    for (const value of values) {
      if (!bits) continue;
      const shift = this.bit % 32;
      if (!shift) this.words.push(0);
      this.words[this.words.length - 1] =
        (this.words[this.words.length - 1] | (value << shift)) >>> 0;
      if (shift + bits > 32) this.words.push(value >>> (32 - shift));
      this.bit += bits;
    }
    this.bit = this.words.length * 32;
  }
}
