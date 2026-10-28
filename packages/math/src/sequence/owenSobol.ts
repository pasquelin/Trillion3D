/**
 * AN OWEN-SCRAMBLED SOBOL SEQUENCE, drawn per pixel with the error of nearby pixels diffused: the points of a pixel are the
 * `sampleIndex`-th of one Sobol sequence shared by the whole image, the index made of the pixel's place on a Hilbert curve (so that
 * pixels close on the screen take close tiles of the sequence), the frame and the sample, then scrambled digit by digit from the
 * left (Owen's scrambling, in the cheap hash form that is nearly as good as the bit-by-bit one). The first two dimensions of the
 * sequence are Sobol's (0,2)-sequence; the third and fourth the next dimensions of the same family (Ahmed, Pharr, Ostromoukhov,
 * Huang, "SZ sequences: binary-based (0,2^q)-sequences", 2025; Ahmed, "An implementation algorithm of 2D Sobol sequence fast,
 * elegant, and compact", 2024; Ahmed and Wonka, "Screen-space blue-noise diffusion of Monte Carlo sampling error via hierarchical
 * ordering of pixels", 2020). Words are 32 bits; a point is its word's top 24 bits over 2^24.
 */

import { reverseBits32 } from '../scalar/bits.ts'

/** The place of the point (`x`, `y`) of a square of `2^bits` points a side along its Hilbert curve (the point's coordinates past `bits` bits wrap). */
function hilbertIndex(x: number, y: number, bits: number) {
  let index = 0
  let state = 0
  for (let i = bits - 1; i >= 0; i--) {
    const row = 8 * state + 4 * ((x >>> i) & 1) + 2 * ((y >>> i) & 1)
    index = index * 4 + ((0x361e9cb4 >>> row) & 3)
    state = (0x8fe65831 >>> row) & 3
  }
  return index
}

/** The seed after one draw: a linear congruential step (Steele and Vigna, 2022). */
const nextSeed = (seed: number) => (Math.imul(seed, 0x915f77f5) + 0x93d765dd) >>> 0

/** The word `bitsReversed` (an index whose bits are mirrored) scrambled by `seed`, mirrored back so that the scrambling runs from the left. */
function scrambled(bitsReversed: number, seed: number) {
  let index = (bitsReversed ^ Math.imul(bitsReversed, 0xe0705d72)) >>> 0
  index = (index + seed) >>> 0
  const mixed = (seed ^ (seed >>> 16)) >>> 0
  index = Math.imul(index, (mixed | 1) >>> 0) >>> 0
  return reverseBits32(index)
}

/** The second dimension's word of a Sobol index (Ahmed's listing, mirrored): each step xors in the bits a mask keeps, shifted right. */
function folded(word: number) {
  let v = word >>> 0
  v = (v ^ (v >>> 16)) >>> 0
  v = (v ^ ((v & 0xff00ff00) >>> 8)) >>> 0
  v = (v ^ ((v & 0xf0f0f0f0) >>> 4)) >>> 0
  v = (v ^ ((v & 0xcccccccc) >>> 2)) >>> 0
  return (v ^ ((v & 0xaaaaaaaa) >>> 1)) >>> 0
}

/** The third dimension's word of the Sobol index `index` (before the mirroring and the scrambling). */
function thirdDimension(index: number) {
  let z = ((index >>> 1) & 0x50550550) ^ (index & 0xaf5af5af) ^ ((index << 1) & 0xa0aa0aa0)
  z = (z ^ (z << 16)) >>> 0
  z = (z ^ ((z & 0x00ff00ff) << 8)) >>> 0
  z = (z ^ ((z & 0x0f0f0f0f) << 4)) >>> 0
  return (
    (((z >>> 1) & 0x50550550) ^
      (z & 0x5fa5fa5f) ^
      ((z << 1) & 0xa4ea4ea4) ^
      ((z << 2) & 0xc84c84c8) ^
      ((z << 3) & 0x08808808)) >>>
    0
  )
}

/**
 * The first three dimensions of the point of the pixel (`x`, `y`) at `frame`, the sample `sampleIndex` of `sampleCount`, each in [0, 1):
 * the index `(tile · sampleCount + sampleIndex)` of the sequence, `tile` the pixel's place on the Hilbert curve over its low 8 bits
 * plus 65536 a frame, the seed starting from zero so that every pixel follows the same sequence.
 */
export function owenSobolPoint(
  x: number,
  y: number,
  frame: number,
  sampleIndex: number,
  sampleCount: number,
): [number, number, number] {
  const tile = hilbertIndex(x, y, 8) + frame * 65536
  const index = reverseBits32((Math.imul(tile, sampleCount) + sampleIndex) >>> 0)
  let seed = nextSeed(0)
  // The index scrambled first, to decorrelate it from the other tuples; the Sobol point of that index.
  const sobol = scrambled(index, seed)
  const third = reverseBits32(thirdDimension(sobol))
  const words = [sobol, folded(sobol), third]
  return words.map((word) => {
    seed = nextSeed(seed)
    return (scrambled(word, seed) >>> 8) * 2 ** -24
  }) as [number, number, number]
}
