import { GOLDEN_U32 } from '../constants.ts'
import { mulberry32 } from './random.ts'
import {
  energyWeights,
  NOISE_SEED,
  NOISE_SIGMA,
  volumeAddress,
  type NoiseVolume,
  type VolumeAddress,
} from './noiseEnergy.ts'

/**
 * A MASK OF TWO-DIMENSIONAL VECTORS made blue noise by simulated annealing (Georgiev and Fajardo, "Blue-noise dithered sampling",
 * 2016; its energy made spatiotemporal by Wolfe, Morrical, Akenine-Möller and Ramamoorthi, 2022): a volume of vectors, uniform
 * and independent at first, whose pixels are swapped two at a time, a swap kept when it lowers the energy of the whole mask
 * (`noiseEnergy.ts` gives the weights).
 *
 * The energy a pixel receives from each neighbour, in its image or along its frames, is the neighbour's weight times
 * `exp(−d^(2/3) / 2σᵥ²)` over `d`, the sum of the two coordinates' differences: vectors near each other in value
 * make a costly pair, so a mask made of them has neighbours far from each other in value, in space and in time.
 */

/** How a mask is annealed: the spread of the energy in space and in value, and the run's length. */
interface AnnealingOptions {
  /** The spread of the energy over the pixels, on every axis. */
  sigma: number
  /** The spread of the energy over the values. */
  valueSigma: number
  /** The swaps made, in the square of the pixel count: the run's length. */
  swapCountFactor: number
  /** The share of the run in which a swap that raises the energy may still be kept, with the same factor: the cooling's length. */
  coolingFactor: number
  seed: number
}

/** The run the method is published with. */
export const ANNEALING_DEFAULTS: AnnealingOptions = {
  sigma: NOISE_SIGMA,
  valueSigma: 1,
  swapCountFactor: 0.001,
  coolingFactor: 0.00001,
  seed: NOISE_SEED,
}

/** Steps of the table `exp(−d^(2/3) / 2σᵥ²)` is read from, over the distances 0 to 2. */
const TABLE_STEPS = 1 << 14
const TABLE_SCALE = TABLE_STEPS / 2

/** The energy a pair of vectors `d` apart in value (the sum of their coordinates' differences) gives. */
function valueTable(valueSigma: number) {
  const table = new Float32Array(TABLE_STEPS + 2)
  for (let step = 0; step < table.length; step++)
    table[step] = Math.exp(-Math.pow(step / TABLE_SCALE, 2 / 3) / (2 * valueSigma * valueSigma))
  return table
}

/** What a swap's energy reads: the neighbours of a pixel with the weight each gives, and the value table. */
interface Neighbours {
  address: VolumeAddress
  table: Float32Array
  /** The plane's offsets (the pixel's own apart) and weights, row after row. */
  rows: number
  columns: number
  fromX: number
  fromY: number
  planeWeights: Float32Array
  /** The time axis's offsets and weights, the pixel's own apart. */
  frames: Int32Array
  frameWeights: Float32Array
}

/** The neighbours of every pixel of a mask of `volume`: the weights of each axis, summed with its centre. */
function neighbours(volume: NoiseVolume, options: AnnealingOptions): Neighbours {
  const weights = energyWeights(volume, options.sigma, true)
  const { x, y, z } = weights
  const columns = x.to - x.from + 1,
    rows = y.to - y.from + 1
  const planeWeights = new Float32Array(rows * columns)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < columns; c++)
      planeWeights[r * columns + c] =
        r + y.from === 0 && c + x.from === 0
          ? 0
          : y.weights[Math.abs(r + y.from)] * x.weights[Math.abs(c + x.from)]
  const offsets: number[] = []
  for (let dz = z.from; dz <= z.to; dz++) if (dz !== 0) offsets.push(dz)
  return {
    address: volumeAddress(volume),
    table: valueTable(options.valueSigma),
    rows,
    columns,
    fromX: x.from,
    fromY: y.from,
    planeWeights,
    frames: Int32Array.from(offsets),
    frameWeights: Float32Array.from(offsets, (dz) => z.weights[Math.abs(dz)]),
  }
}

/**
 * How much more the pixel `pixel` receives, summed over its neighbours but the one named `except`, if it held the vector
 * `(un, vn)` instead of `(uo, vo)`: each neighbour's weight times the difference of the energy of the two pairs, in the neighbour's
 * own value, `cells` holding vectors two floats a pixel.
 */
function receivedMore(
  n: Neighbours,
  cells: Float32Array,
  pixel: number,
  except: number,
  uo: number,
  vo: number,
  un: number,
  vn: number,
) {
  const { address: a, table, planeWeights, frames, frameWeights } = n
  const x = pixel & a.xMask,
    y = (pixel >> a.yShift) & a.yMask,
    z = pixel >> a.zShift
  let sum = 0
  for (let r = 0; r < n.rows; r++) {
    const row = (z << a.zShift) + (((y + r + n.fromY) & a.yMask) << a.yShift)
    for (let c = 0; c < n.columns; c++) {
      const w = planeWeights[r * n.columns + c]
      if (w === 0) continue
      const q = row + ((x + c + n.fromX) & a.xMask)
      if (q === except) continue
      const uq = cells[2 * q],
        vq = cells[2 * q + 1]
      sum +=
        w *
        (table[((Math.abs(un - uq) + Math.abs(vn - vq)) * TABLE_SCALE + 0.5) | 0] -
          table[((Math.abs(uo - uq) + Math.abs(vo - vq)) * TABLE_SCALE + 0.5) | 0])
    }
  }
  const column = pixel & ((1 << a.zShift) - 1)
  for (let k = 0; k < frames.length; k++) {
    const q = (((z + frames[k]) & a.zMask) << a.zShift) + column
    if (q === except) continue
    const uq = cells[2 * q],
      vq = cells[2 * q + 1]
    sum +=
      frameWeights[k] *
      (table[((Math.abs(un - uq) + Math.abs(vn - vq)) * TABLE_SCALE + 0.5) | 0] -
        table[((Math.abs(uo - uq) + Math.abs(vo - vq)) * TABLE_SCALE + 0.5) | 0])
  }
  return sum
}

/** How much the energy of the whole mask changes if the vectors of pixels `a` and `b` are swapped: twice what the two pixels receive more. */
function swapChange(n: Neighbours, cells: Float32Array, a: number, b: number) {
  const ua = cells[2 * a],
    va = cells[2 * a + 1],
    ub = cells[2 * b],
    vb = cells[2 * b + 1]
  return (
    2 *
    (receivedMore(n, cells, a, b, ua, va, ub, vb) + receivedMore(n, cells, b, a, ub, vb, ua, va))
  )
}

/** The vectors of a mask at first: two uniform numbers in [0, 1) a pixel, from the seed. */
function whiteVectors(count: number, seed: number) {
  const random = mulberry32(seed)
  return Float32Array.from({ length: count * 2 }, () => random())
}

/**
 * The vectors of a mask of `volume`, two floats a pixel (`0 … 1`), annealed: from `swaps` random pairs of pixels, a pair is swapped
 * when that lowers the energy of the whole mask, or, while the temperature (1 falling to 0 over the first `cooling` swaps)
 * is above a random number, whatever it does to it. `progress` is told how many swaps are made, now and again.
 */
export function annealVectors(
  volume: NoiseVolume,
  options: AnnealingOptions = ANNEALING_DEFAULTS,
  progress?: (done: number, total: number) => void,
) {
  const n = neighbours(volume, options)
  const count = n.address.count
  const cells = whiteVectors(count, options.seed)
  const total = Math.max(1, Math.floor(options.swapCountFactor * count * count))
  const cooling = options.coolingFactor * count * count
  const random = mulberry32(options.seed ^ GOLDEN_U32)
  for (let done = 0; done < total; done++) {
    const temperature = Math.max(1 - done / cooling, 0)
    const a = Math.floor(random() * count),
      b = Math.floor(random() * count)
    if (a === b) continue
    if (swapChange(n, cells, a, b) <= 0 || random() < temperature) {
      const u = cells[2 * a],
        v = cells[2 * a + 1]
      cells[2 * a] = cells[2 * b]
      cells[2 * a + 1] = cells[2 * b + 1]
      cells[2 * b] = u
      cells[2 * b + 1] = v
    }
    if (progress && done % 1_000_000 === 0) progress(done, total)
  }
  return cells
}
