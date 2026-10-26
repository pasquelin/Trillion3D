// What the tests of the basic method share: pictures as arrays of texels, the grid the measure
// sums built as the setup and the chain's levels define it, the shipped lanes run over it, and the
// reference's own sums of it by lane.
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import type { ExposureValues } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { BASIC_SETUP_WGSL } from './basicWgsl.ts'
import { BASIC_LANES, BASIC_SIDE, METER_WORDS } from './meterLayout.ts'
import { luminanceReading } from './meterParams.ts'
import { MEASURE_WGSL } from './meterWgsl.ts'
import { BUCKETS, meterOf, uniformOf } from './meter.fixture.ts'

/** An image of `width × height` texels of four channels, row after row. */
export type Picture = { width: number; height: number; data: Float64Array }

/** The metering mask as a function of the place in the image, `[0, 1]` each way. */
export type Mask = (u: number, v: number) => number

export const pictureOf = (
  width: number,
  height: number,
  colour: (x: number, y: number) => number[],
): Picture => {
  const data = new Float64Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set(colour(x, y), (y * width + x) * 4)
  return { width, height, data }
}
const texel = (p: Picture, x: number, y: number) => {
  const at = (Math.min(y, p.height - 1) * p.width + Math.min(x, p.width - 1)) * 4
  return [...p.data.subarray(at, at + 4)]
}

/** The level under `p`, each texel the mean of the `size × size` texels `first` texels before the
 *  two it covers, the edge's last texel read where the window leaves the image: `down(p, 2, 0)` the
 *  half-size image, `down(p, 4, -1)` a level of the grid. */
function down(p: Picture, size: number, first: number) {
  return pictureOf(Math.ceil(p.width / 2), Math.ceil(p.height / 2), (x, y) => {
    const sum = [0, 0, 0, 0]
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++)
        texel(p, 2 * x + first + i, 2 * y + first + j).forEach((v, c) => (sum[c] += v))
    return sum.map((v) => v / (size * size))
  })
}

/** The size of the images the tests of the basic method meter. */
export const SIZE: [number, number] = [512, 256]

/** The grid the measure ends on, as the shipped setup and the levels' definition make it: the
 *  image at half size and again at the quarter, each texel placed by `scaledLog`, then four levels
 *  of 4 × 4 means of the placed values. */
export function gridOf(settings: ExposureValues, image: Picture) {
  const meter = meterOf(uniformOf(settings, { size: SIZE }))
  const { scaledLog } = shaderRun<{ scaledLog: (colour: number[]) => number }>(
    BASIC_SETUP_WGSL,
    ['scaledLog'],
    { meter },
  )
  const quarter = down(down(image, 2, 0), 4, -1)
  let level = pictureOf(quarter.width, quarter.height, (x, y) => [
    0,
    0,
    0,
    scaledLog(texel(quarter, x, y)),
  ])
  for (let stage = 0; stage < 4; stage++) level = down(level, 4, -1)
  return level
}

/** The measure over `grid`: the shipped lanes, each leaving its four sums in its own words of the
 *  buffer, run one after the other. Returns the words the update reads. */
export function measureOf(settings: ExposureValues, grid: Picture, mask?: Mask) {
  const meter = meterOf(uniformOf(settings, { size: SIZE, masked: !!mask }))
  const histogram = new Array<number>(METER_WORDS).fill(0)
  const kernel = shaderRun<{
    laneSums: (lane: number, size: number[]) => number[]
    leaveLane: (lane: number, sums: number[]) => void
  }>(MEASURE_WGSL, ['laneSums', 'leaveLane'], {
    meter,
    image: 'grid',
    histogram,
    meterMask: 'mask',
    meterSampler: 'sampler',
    textureDimensions: () => [grid.width, grid.height],
    textureLoad: (_: string, at: number[]) => [0, 0, 0, texel(grid, at[0], at[1])[3]],
    textureSampleLevel: (_: string, __: string, uv: number[]) => [
      mask ? mask(uv[0], uv[1]) : 1,
      0,
      0,
      1,
    ],
    atomicStore: (ref: { set(value: number): void }, value: number) => ref.set(value),
  })
  for (let lane = 0; lane < BASIC_LANES; lane++)
    kernel.leaveLane(lane, kernel.laneSums(lane, [grid.width, grid.height]))
  return histogram
}

/** The grid's texels the lane `lane` sums, as the reference splits them: the grid's size times the
 *  lane's place over the lanes along an axis, whole texels. */
function laneTexels(grid: Picture, lane: number) {
  const share = [lane % BASIC_SIDE, Math.floor(lane / BASIC_SIDE)]
  const range = (at: number, size: number) => [
    Math.floor((size * share[at]) / BASIC_SIDE),
    Math.floor((size * (share[at] + 1)) / BASIC_SIDE),
  ]
  const [x0, x1] = range(0, grid.width),
    [y0, y1] = range(1, grid.height)
  const texels: number[][] = []
  for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) texels.push([x, y])
  return texels
}

/** What the reference's definition says of the grid: the mean log luminance weighted by the mask
 *  (no less than 0.05) and the darkest bucket's weight; and, lane by lane, the plain mean of the
 *  log luminance with the lane's texel count. */
export function modelOf(settings: ExposureValues, grid: Picture, mask?: Mask) {
  const { scale, bias } = luminanceReading(settings)
  const logOf = (placed: number) => (placed - bias) / scale
  let weights = 0,
    weighted = 0
  const lanes: { mean: number; count: number }[] = []
  for (let lane = 0; lane < BASIC_LANES; lane++) {
    let sum = 0
    const texels = laneTexels(grid, lane)
    for (const [x, y] of texels) {
      const placed = texel(grid, x, y)[3]
      let weight = Math.max(mask ? mask(x / grid.width, y / grid.height) : 1, 0.05)
      if (Math.floor(Math.min(Math.max(placed, 0), 1) * (BUCKETS - 1)) === 0)
        weight *= settings.exposureBlackBucketWeight
      weights += weight
      weighted += weight * logOf(placed)
      sum += logOf(placed)
    }
    if (texels.length) lanes.push({ mean: sum / texels.length, count: texels.length })
  }
  return { mean: weights > 0 ? weighted / weights : logOf(0), lanes }
}

/** The reference's log gain of the local exposure for a base layer at `base`, around the grey
 *  `grey`, with no thresholds and no detail: the base's distance from the grey scaled by the
 *  contrast of its side. */
export const logGainOf = (base: number, grey: number, high: number, low: number) =>
  grey + (base - grey) * (base > grey ? high : low) - base
