/**
 * THE ENERGY A SPATIOTEMPORAL BLUE-NOISE MASK IS MADE BY (Wolfe, Morrical, Akenine-Möller and Ramamoorthi, "Spatiotemporal
 * Blue Noise Masks", 2022, on the void-and-cluster method of Ulichney, 1993).
 *
 * A mask is `depth` images (the frames) of `width × height` pixels, each size a power of two, stored image after image and row
 * after row: the pixel `(x, y)` of frame `z` is the index `(z · height + y) · width + x`, which is also the texel
 * `(x, z · height + y)` of the texture the frames are stacked down. Distances are measured on the torus along every axis, so
 * that an image tiles in space and the frames tile in time.
 *
 * Two pixels give each other energy only when they lie in the same image — a Gaussian of their distance on the plane — or in
 * the same place of two frames — a Gaussian of the frames between them —, never otherwise: a mask that spreads its values by
 * this energy is blue noise in every image and along every pixel's time axis. Each axis has its own Gaussian, cut where it
 * has lost half a percent of its energy; the energy a pixel gives is the product of its two plane axes' weights, or its time
 * axis's alone.
 */

/** The sizes of a mask: the pixels along an image's two sides, and the images. */
export interface NoiseVolume {
  width: number
  height: number
  depth: number
}

/** The Gaussian's spread, in pixels, a mask is made at on every axis. */
export const NOISE_SIGMA = 1.9

/** The energy a Gaussian may lose where it is cut: the cut lies where it falls to `exp(−5.298)`. */
const CUT_LOSS = 0.005

/** One axis's weights: the offsets it reaches, `from` to `to` pixels, and the weight at each distance `|offset|`. */
export interface AxisWeights {
  from: number
  to: number
  weights: Float32Array
}

/**
 * The weights of an axis of `size` pixels at spread `sigma`: `exp(−d² / 2σ²)` at the distances up to where it has lost
 * `CUT_LOSS` (and at most half the axis), divided by the sum of the weights beyond the centre — or, with `centre`, of
 * all of them. A cut wider than the axis (`2 · reach + 1 > size`) reaches `reach − 1` pixels one way and `reach` the other,
 * so that no offset names a pixel twice.
 */
export function axisWeights(size: number, sigma: number, centre: boolean): AxisWeights {
  const reach = Math.min(
    Math.floor(Math.sqrt(-2 * sigma * sigma * Math.log(CUT_LOSS))),
    Math.max(1, size >> 1),
  )
  const weights = new Float32Array(reach + 1)
  for (let d = 0; d <= reach; d++) weights[d] = Math.exp(-(d * d) / (2 * sigma * sigma))
  weights[0] = 1
  let sum = centre ? 1 : 0
  for (let d = 1; d <= reach; d++) sum += weights[d]
  for (let d = 0; d <= reach; d++) weights[d] = Math.fround(weights[d] / sum)
  return { from: reach * 2 + 1 > size ? 1 - reach : -reach, to: reach, weights }
}

/** The three axes' weights of a mask of `volume`. */
export interface EnergyWeights {
  x: AxisWeights
  y: AxisWeights
  z: AxisWeights
}

/** The weights of a mask of `volume` at `sigma` on every axis; `centre` is whether each axis's weights sum with the centre's. */
export function energyWeights(volume: NoiseVolume, sigma = NOISE_SIGMA, centre = false) {
  return {
    x: axisWeights(volume.width, sigma, centre),
    y: axisWeights(volume.height, sigma, centre),
    z: axisWeights(volume.depth, sigma, centre),
  }
}

/** How the pixels of a mask are addressed: their count, the masks of each axis and the shifts of `(z · height + y) · width + x`. */
export interface VolumeAddress {
  count: number
  xMask: number
  yMask: number
  zMask: number
  /** `log2(width)`, and `log2(width · height)`. */
  yShift: number
  zShift: number
}

/** The addressing of `volume`, whose sizes must be powers of two, at least two. */
export function volumeAddress({ width, height, depth }: NoiseVolume): VolumeAddress {
  for (const size of [width, height, depth])
    if (size < 2 || (size & (size - 1)) !== 0) throw new RangeError('a mask side is a power of two')
  const yShift = Math.log2(width)
  return {
    count: width * height * depth,
    xMask: width - 1,
    yMask: height - 1,
    zMask: depth - 1,
    yShift,
    zShift: yShift + Math.log2(height),
  }
}

/** The 8 bits a rank among `count` is stored as: its share of the range, truncated, so that every value is made as often as any other. */
export const rankByte = (rank: number, count: number) =>
  Math.min(255, Math.floor((rank / count) * 256))
