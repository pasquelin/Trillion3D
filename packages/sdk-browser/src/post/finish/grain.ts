import { unorm8 } from '../../../../math/src/color/color.ts'
import { mulberry32 } from '../../../../math/src/sequence/random.ts'
import { TAU } from '../../../../math/src/constants.ts'
import { saturate } from '../../../../math/src/scalar/reals.ts'

/** Side of the grain's texture, in texels. */
export const GRAIN_TEXTURE_SIDE = 128
/** Channels of a texel: the grain's three, and a coverage that is read by nothing. */
const CHANNELS = 4
/** The seed of the texture's draws: a texture is the same on every run and every machine. */
const GRAIN_SEED = 0x6772616e

/**
 * What the grain texture of the reference, a 128 × 128 scan of film grain, measures — the only
 * thing the look of the generated texture is built from, the texels themselves being an authored
 * asset that is not copied. Each channel of its texels has a mean near a half and its own spread
 * (`std`), skewed toward the bright (`skew`) and a little heavier in its tails than a bell
 * (`kurtosis`, the excess over a normal's); the three channels follow one another (`correlation`,
 * the red-green, red-blue and green-blue Pearson coefficients); a texel follows its neighbour at
 * one texel's distance along each axis, a channel's own way (`neighbour`, the red, the green and
 * the blue's, none past two): the scan's grain is streakier along one axis than the other. The
 * grain's decode (`grainTexels`) makes its strength the spread over the mean: 0.139, 0.111 and
 * 0.154 of the light, a channel each.
 */
const GRAIN_STATISTICS = {
  channels: [
    { mean: 0.5061, std: 0.0704, skew: 0.476, kurtosis: 0.652 },
    { mean: 0.5036, std: 0.0558, skew: 0.302, kurtosis: 0.193 },
    { mean: 0.5082, std: 0.0781, skew: 0.571, kurtosis: 0.598 },
  ],
  correlation: { redGreen: 0.62, redBlue: 0.406, greenBlue: 0.542 },
  neighbour: { x: [0.2, 0.15, 0.2], y: [0.06, 0.18, 0.3] },
} as const

/** What the texture holds: its texels, and what each channel is multiplied by to have a mean of 1. */
type GrainTexels = { bytes: Uint8Array<ArrayBuffer>; decode: [number, number, number] }

/** `count` independent draws of a standard normal, by the Box–Muller transform of `draw`'s. */
function normals(count: number, draw: () => number) {
  const out = new Float64Array(count)
  for (let i = 0; i < count; i += 2) {
    const radius = Math.sqrt(-2 * Math.log(1 - draw())),
      angle = TAU * draw()
    out[i] = radius * Math.cos(angle)
    if (i + 1 < count) out[i + 1] = radius * Math.sin(angle)
  }
  return out
}

/** The plane `plane`, `side` texels a side, blurred along one axis by the kernel `k, 1, k`
 *  — wrapping at its edges, so the texture repeats without a seam — and scaled to keep its
 *  variance: two such passes, one on each axis, give texels that follow their neighbours by
 *  `2k / (1 + 2k²)` along each. */
function blurred(plane: Float64Array, side: number, k: number, vertical: boolean) {
  const out = new Float64Array(plane.length),
    norm = Math.sqrt(1 + 2 * k * k),
    step = vertical ? side : 1,
    across = vertical ? 1 : side
  for (let line = 0; line < side; line++)
    for (let i = 0; i < side; i++) {
      const at = line * across + i * step
      const before = plane[line * across + ((i + side - 1) % side) * step]
      const after = plane[line * across + ((i + 1) % side) * step]
      out[at] = (k * before + plane[at] + k * after) / norm
    }
  return out
}

/** The Cornish–Fisher quantile of a standard normal `z` for a distribution of the skewness `skew`
 *  and the excess kurtosis `kurtosis`: the series, to the fourth moment, that bends a bell into
 *  it. */
const bent = (z: number, skew: number, kurtosis: number) =>
  z +
  (skew / 6) * (z * z - 1) +
  (kurtosis / 24) * (z * z * z - 3 * z) -
  ((skew * skew) / 36) * (2 * z * z * z - 5 * z)

/** The blur kernel `k, 1, k` that makes texels follow their neighbours by `correlation` along an
 *  axis once scaled (`blurred`): the root of `2k / (1 + 2k²) = correlation`, none for 0. */
const kernelOf = (correlation: number) =>
  correlation > 0 ? (1 - Math.sqrt(1 - 2 * correlation * correlation)) / (2 * correlation) : 0

let cached: GrainTexels | undefined

/** The three planes of correlated normal noise the texture is shaped from, `GRAIN_TEXTURE_SIDE`
 *  squared texels each, blurred, then mixed by the Cholesky factor of the channels' correlations.
 *  The mix adds the planes' squared weights of their neighbour correlations, so each plane is
 *  blurred for the share a channel asks that the planes before it did not give (`own`): a channel
 *  follows its neighbours along each axis by its own measured number. */
function correlatedPlanes() {
  const side = GRAIN_TEXTURE_SIDE,
    { correlation: r, neighbour } = GRAIN_STATISTICS
  const draw = mulberry32(GRAIN_SEED)
  const l21 = r.redGreen,
    l22 = Math.sqrt(1 - l21 * l21),
    l31 = r.redBlue,
    l32 = (r.greenBlue - l31 * l21) / l22,
    l33 = Math.sqrt(1 - l31 * l31 - l32 * l32)
  /** The neighbour correlation of each plane, so that the mix of them gives each channel's. */
  const own = ([red, green, blue]: readonly number[]) => {
    const second = (green - l21 * l21 * red) / (l22 * l22)
    return [red, second, (blue - l31 * l31 * red - l32 * l32 * second) / (l33 * l33)]
  }
  const [alongX, alongY] = [own(neighbour.x), own(neighbour.y)]
  const [a, b, c] = [0, 1, 2].map((p) =>
    blurred(
      blurred(normals(side * side, draw), side, kernelOf(alongX[p]), false),
      side,
      kernelOf(alongY[p]),
      true,
    ),
  )
  return [
    a,
    a.map((x, i) => l21 * x + l22 * b[i]),
    a.map((x, i) => l31 * x + l32 * b[i] + l33 * c[i]),
  ]
}

/**
 * The grain's texture, generated once: `GRAIN_TEXTURE_SIDE` squared texels of a byte a channel,
 * generated to the reference grain's measured statistics (`GRAIN_STATISTICS`): the correlated
 * planes (`correlatedPlanes`) bent to each channel's skewness and kurtosis and set to its mean and
 * spread exactly; the planes wrap, so the texture repeats without a seam. `decode` is what the
 * reference reduces its texture to for the same purpose: the number of texels over the sum of a
 * channel, so that the texture times it has a mean of 1 and the grain neither brightens nor
 * darkens the image.
 */
export function grainTexels(): GrainTexels {
  if (cached) return cached
  const count = GRAIN_TEXTURE_SIDE * GRAIN_TEXTURE_SIDE
  const bytes = new Uint8Array(count * CHANNELS)
  const sums = [0, 0, 0]
  correlatedPlanes().forEach((plane, channel) => {
    const { mean, std, skew, kurtosis } = GRAIN_STATISTICS.channels[channel]
    const shaped = plane.map((z) => bent(z, skew, kurtosis))
    const centre = shaped.reduce((sum, x) => sum + x, 0) / count
    const spread = Math.sqrt(shaped.reduce((sum, x) => sum + (x - centre) ** 2, 0) / count)
    for (let texel = 0; texel < count; texel++) {
      const byte = unorm8(saturate(mean + (std * (shaped[texel] - centre)) / spread))
      bytes[texel * CHANNELS + channel] = byte
      sums[channel] += byte / 255
    }
  })
  for (let texel = 0; texel < count; texel++) bytes[texel * CHANNELS + 3] = 255
  const [dr, dg, db] = sums.map((sum) => count / sum)
  return (cached = { bytes, decode: [dr, dg, db] })
}

/** Bytes the grain's texture holds. */
export const GRAIN_BYTES = GRAIN_TEXTURE_SIDE * GRAIN_TEXTURE_SIDE * CHANNELS

/**
 * The grain's texture, uploaded, and the sampler that repeats it bilinearly, made at the first
 * ask (`view`, `sampler`) and kept: a finishing that draws no grain holds neither.
 */
export function lazyGrain(device: GPUDevice) {
  let made: { texture: GPUTexture; view: GPUTextureView; sampler: GPUSampler } | undefined
  const make = () => {
    if (made) return made
    const texture = device.createTexture({
      label: 'Trillion3D display finish grain',
      size: [GRAIN_TEXTURE_SIDE, GRAIN_TEXTURE_SIDE],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    const layout = { bytesPerRow: GRAIN_TEXTURE_SIDE * CHANNELS }
    device.queue.writeTexture({ texture }, grainTexels().bytes, layout, [
      GRAIN_TEXTURE_SIDE,
      GRAIN_TEXTURE_SIDE,
    ])
    const sampler = device.createSampler({
      label: 'Trillion3D display finish grain',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      magFilter: 'linear',
      minFilter: 'linear',
    })
    return (made = { texture, view: texture.createView(), sampler })
  }
  return {
    view: () => make().view,
    sampler: () => make().sampler,
    /** Bytes held: none until the first ask. */
    get bytes() {
      return made ? GRAIN_BYTES : 0
    },
    dispose: () => made?.texture.destroy(),
  }
}
