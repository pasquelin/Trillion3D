import { mulberry32 } from './random.ts'
import { NOISE_SIGMA, type NoiseVolume } from './noiseEnergy.ts'
import {
  buildTree,
  createField,
  extremum,
  flip,
  refresh,
  splat,
  type EnergyField,
  type ExtremumTree,
} from './noiseField.ts'

/** The share of the pixels the first binary pattern turns on: the density that gave the best masks. */
const INITIAL_DENSITY = 0.1

/** The seed of the first pattern, so that a mask is the same on every run. */
const NOISE_SEED = 0x1337feed

/** Turns `pixel` on or off and brings the trees up to date with what that changed. */
function move(field: EnergyField, trees: readonly ExtremumTree[], pixel: number, on: boolean) {
  flip(field, pixel, on)
  refresh(field, trees)
}

/** The first pattern: `ones` distinct pixels, drawn at random, on. */
function seedPattern(field: EnergyField, seed: number, density: number) {
  const { count } = field.address
  const ones = Math.max(2, Math.floor(count * density))
  const random = mulberry32(seed)
  for (let placed = 0; placed < ones;) {
    const pixel = Math.floor(random() * count)
    if (field.on[pixel]) continue
    flip(field, pixel, true)
    placed++
  }
  refresh(field, [])
}

/**
 * The first pattern made blue noise: the pixel on in the tightest cluster is turned off and the one off in the largest void
 * turned on, until they are the same pixel.
 */
function relax(field: EnergyField) {
  const trees = [buildTree(field, 'cluster'), buildTree(field, 'void')]
  for (;;) {
    const cluster = extremum(trees[0])
    move(field, trees, cluster, false)
    const hole = extremum(trees[1])
    move(field, trees, hole, true)
    if (cluster === hole) return
  }
}

/** Phase I: the pattern ordered. The tightest cluster is turned off, its rank the number of pixels still on, until none is. */
function orderPattern(field: EnergyField, ranks: Uint32Array) {
  const tree = buildTree(field, 'cluster')
  for (let left = field.onCount; left > 0;) {
    const pixel = extremum(tree)
    left--
    move(field, [tree], pixel, false)
    ranks[pixel] = left
  }
}

/** The pattern put back: every pixel that has a rank is on, its energy given. */
function restorePattern(field: EnergyField, ranks: Uint32Array) {
  const unranked = ranks.length
  for (let pixel = 0; pixel < unranked; pixel++) {
    if (ranks[pixel] >= unranked) continue
    field.on[pixel] = 1
    field.onCount++
    splat(field, pixel, 1)
  }
  refresh(field, [])
}

/** Phase II: the largest void is turned on, its rank the number of pixels on before it, until half of them are. */
function fillHalf(field: EnergyField, ranks: Uint32Array) {
  const tree = buildTree(field, 'void')
  const half = ranks.length >> 1
  while (field.onCount < half) {
    const pixel = extremum(tree)
    const rank = field.onCount
    move(field, [tree], pixel, true)
    ranks[pixel] = rank
  }
}

/** The meaning of off and on reversed: the energy of the pixels that were off is made again from nothing. */
function reversePattern(field: EnergyField) {
  field.energy.fill(0)
  field.onCount = 0
  for (let pixel = 0; pixel < field.address.count; pixel++) {
    field.on[pixel] ^= 1
    if (!field.on[pixel]) continue
    field.onCount++
    splat(field, pixel, 1)
  }
  refresh(field, [])
}

/** Phase III: the tightest cluster of the pixels that were off is turned off, its rank counting up from where phase II stopped. */
function orderSecondHalf(field: EnergyField, ranks: Uint32Array) {
  const tree = buildTree(field, 'cluster')
  for (let left = field.onCount; left > 0; left--) {
    const pixel = extremum(tree)
    move(field, [tree], pixel, false)
    ranks[pixel] = ranks.length - left
  }
}

/**
 * The ranks of a spatiotemporal blue-noise mask of `volume`, one a pixel, each of `0 … count − 1` once: the pixel's place in the
 * order the void-and-cluster method fills the volume, so that the values `rank / count` are uniform and blue in every image and
 * along every pixel's frames (`noiseEnergy.ts`). The same on every run for the same arguments.
 *
 * The method's steps, in order: a first pattern of `density` of the pixels, drawn at random (each pixel once — a pixel drawn twice
 * would give its energy twice and take it back once); that pattern relaxed (`relax`); the rank of each pixel of it, by
 * removing the tightest cluster (`orderPattern`); the pattern put back (`restorePattern`) and filled to half the pixels by the
 * largest voids (`fillHalf`); the pixels' state reversed (`reversePattern`) and the second half ranked by removing the tightest
 * cluster (`orderSecondHalf`).
 */
export function voidAndCluster(
  volume: NoiseVolume,
  sigma = NOISE_SIGMA,
  density = INITIAL_DENSITY,
  seed = NOISE_SEED,
) {
  const field = createField(volume, sigma)
  const ranks = new Uint32Array(field.address.count).fill(field.address.count)
  seedPattern(field, seed, density)
  relax(field)
  orderPattern(field, ranks)
  restorePattern(field, ranks)
  fillHalf(field, ranks)
  reversePattern(field)
  orderSecondHalf(field, ranks)
  return ranks
}
