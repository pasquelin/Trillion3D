import { clamp, saturate } from '../../../../math/src/scalar/reals.ts'
import { PRIORITY_HISTOGRAM_SIZE } from './lightingMath.ts'

/**
 * THE LAWS OF THE SURFACE CACHE'S LIGHTING, in numbers: the CPU's copy of what the kernels decide and compute
 * (`packages/sdk-browser/src/lighting/surfaceCache/lighting/`), the oracle the tests hold the laws to — the kernels hold the same
 * formulas in WGSL, and a GPU proof reads their output against these.
 *
 * Each page of the page table has a bucket, 15 for the page lit last image and the lower the longer it has waited and the nearer
 * it lies (`priorityBucket`); the buckets' tiles are counted in a histogram, the cut is the bucket whose tiles reach the
 * budget (`selectMaxUpdateBucket`) and the pages of the buckets up to it are listed in the order the threads reach them while
 * their tiles fit (`planUpdate`).
 */

/** The frames a page that was never lit is taken to have waited. */
const NEVER_LIT_FRAMES = 2048

/** The tiles of a page of `width` × `height` texels, tiles of 8 × 8. */
export const pageTiles = (width: number, height: number) => Math.floor((width * height) / 64)

/**
 * How fast a page's light should follow: one over one plus its distance from the eye over the first clipmap's half
 * side (never negative), doubled where the page lies near the frustum (`nearFrustum`).
 */
export const updateSpeedOf = (distance: number, firstClipmapExtent: number, nearFrustum: boolean) =>
  (1 / (1 + Math.max(distance / firstClipmapExtent, 0))) * (nearFrustum ? 2 : 1)

/**
 * The bucket of a page: 15 minus the log2 of four times the frames since it was lit (2048 for a page never lit,
 * `lastUpdate` 0) times its speed, the log2 held from 0 to 15, the difference cut to a whole number — a log2 of 3 is
 * bucket 12, one above it up to 4 bucket 11 —; the lowest bucket is lit first.
 */
export function priorityBucket(frame: number, lastUpdate: number, speed: number) {
  const waited = lastUpdate === 0 ? NEVER_LIT_FRAMES : frame - lastUpdate
  const level = clamp(Math.log2(Math.max(4 * waited * speed, 1)), 0, PRIORITY_HISTOGRAM_SIZE - 1)
  return Math.trunc(PRIORITY_HISTOGRAM_SIZE - 1 - level)
}

/** What a cut says: the last bucket listed and how many of its tiles are. */
export interface UpdateCut {
  readonly bucket: number
  readonly tiles: number
}

/**
 * The cut of `histogram` (the tiles in each bucket) at `maxTiles`: the first bucket whose tiles bring the total to
 * the budget, with the tiles of it that fit, or the whole histogram's end, with all the budget, where it never does.
 */
export function selectMaxUpdateBucket(histogram: ArrayLike<number>, maxTiles: number): UpdateCut {
  let sum = 0
  let bucket = 0
  for (; bucket < PRIORITY_HISTOGRAM_SIZE; bucket++) {
    if (sum + histogram[bucket] >= maxTiles) return { bucket, tiles: maxTiles - sum }
    sum += histogram[bucket]
  }
  return { bucket, tiles: maxTiles }
}

/** A page for `planUpdate`: its bucket and its tiles. */
export interface PagePriority {
  readonly bucket: number
  readonly tiles: number
}

/**
 * Which pages an update lists, the pages reached in the order given: a page in a bucket past the cut is not; one in
 * the cut's own bucket only while the bucket's tiles keep within the share the cut allows it; and one only while
 * the tiles listed in all keep within `maxTiles`. A page that is not listed still counts its tiles, as the
 * counters are added to before they are looked at — so a page that does not fit closes the list to every later one.
 */
export function planUpdate(pages: readonly PagePriority[], cut: UpdateCut, maxTiles: number) {
  let inBucket = 0
  let listedTiles = 0
  const listed = pages.map(({ bucket, tiles }) => {
    if (bucket > cut.bucket) return false
    if (bucket === cut.bucket) {
      const before = inBucket
      inBucket += tiles
      if (before + tiles > cut.tiles) return false
    }
    const base = listedTiles
    listedTiles += tiles
    return base + tiles <= maxTiles
  })
  return { listed, tiles: pages.reduce((sum, p, k) => sum + (listed[k] ? p.tiles : 0), 0) }
}

/**
 * A light's key in a tile's list: the weight's top 15 bits of the float's bit pattern over the light's index, so that
 * the greater key is the heavier light, the greater index of two of one weight. 0 is none. The weight is a light's
 * luminance times how much of it reaches the tile.
 */
export function lightSampleKey(weight: number, index: number) {
  const bits = new Uint32Array(new Float32Array([weight]).buffer)[0]
  return (((bits << 1) & 0xfffe0000) | (index & 0x3fff)) >>> 0
}

/** The lights `candidates` (their index and weight) that a tile keeps, `cap` at most, the heaviest first. */
export const cullLights = (candidates: readonly { index: number; weight: number }[], cap: number) =>
  candidates
    .map(({ index, weight }) => lightSampleKey(weight, index))
    .filter((key) => key > 0)
    .sort((a, b) => b - a)
    .slice(0, cap)
    .map((key) => key & 0x3fff)

/**
 * The distance a shadow ray starts off its texel, in units of `bias` (the voxel of the global field's clipmap):
 * `bias` plus twice it where the surface turns from the light, by the cosine `nDotL`.
 */
export const shadowRayBias = (nDotL: number, bias: number) => bias + 2 * bias * saturate(1 - nDotL)

/**
 * The jitter of the probes of a page in its `temporal` image, in texels: the `maxFrames` points of a Hammersley set,
 * scrambled by two fixed words, times `spacing`, each cut to a whole texel. `fixed`, from 0 on, replaces the image.
 */
export function probeJitter(temporal: number, maxFrames: number, spacing: number, fixed = -1) {
  const index = (fixed < 0 ? temporal : fixed) % maxFrames
  const x = (index / maxFrames + 0x4ae4 / 65536) % 1
  let reversed = 0
  for (let bit = 0; bit < 32; bit++) if ((index >>> bit) & 1) reversed |= 1 << (31 - bit)
  const y = (((reversed >>> 16) ^ 0x9bdb) >>> 0) / 65536
  return [Math.trunc(x * spacing), Math.trunc(y * spacing)] as const
}

/** The albedo the cache keeps decoded: squared, then, under a boost of 1, lifted in luminance, never to one. */
export function decodeAlbedo(stored: readonly number[], boost: number) {
  const squared = stored.map((c) => c * c)
  if (boost >= 1) return squared
  const luminance = 0.2126 * squared[0] + 0.7152 * squared[1] + 0.0722 * squared[2]
  const lift = Math.pow(luminance, boost) / Math.max(luminance, 1e-8)
  return squared.map((c) => Math.min(saturate(c * lift), 0.99))
}

/** A texel's final light: its decoded albedo over π times the light it receives, plus its emission, never under zero. */
export function finalLighting(
  stored: readonly number[],
  boost: number,
  emission: readonly number[],
  direct: readonly number[],
  indirect: readonly number[],
) {
  const albedo = decodeAlbedo(stored, boost)
  return albedo.map((a, k) => {
    const value = (direct[k] + indirect[k]) * (a / Math.PI) + emission[k]
    return Number.isFinite(value) ? Math.max(value, 0) : 0
  })
}
