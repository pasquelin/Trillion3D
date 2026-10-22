import { GRAIN_TEXTURE_SIDE } from '../../../../sdk-core/src/contracts/filmOptions.ts'
import { unorm8 } from '../../../../math/src/color/color.ts'
import { fract, saturate } from '../../../../math/src/scalar/reals.ts'

/** Channels of a texel: the grain's three, and a coverage that is read by nothing. */
const CHANNELS = 4
/** The sine hash's multipliers: the grain of a position is the fraction of a large multiple of the
 *  sine of its coordinates, the first multiplied by the second. */
const HASH_SKEW = 543.31
const HASH_SCALE = 493013

/** What the texture holds: its texels, and what each channel is multiplied by to have a mean of 1. */
type GrainTexels = { bytes: Uint8Array<ArrayBuffer>; decode: [number, number, number] }

/**
 * The grain's noise at `at`: the sine hash `fract(sin(x + y · 543.31) · 493013)` — a uniform
 * number from 0 to 1 — made triangular on [−1, 1]: `n = 2h − 1`, then `s − s · √(1 − |n|)` with
 * `s` the sign of `n`, which has its mode at 0 and falls to 0 at ±1.
 */
export function grainNoise(x: number, y = 0) {
  const n = 2 * fract(Math.sin(x + y * HASH_SKEW) * HASH_SCALE) - 1
  const side = Math.sign(n)
  return side - side * Math.sqrt(saturate(1 - Math.abs(n)))
}

let cached: GrainTexels | undefined

/**
 * The grain's texture, generated once: `GRAIN_TEXTURE_SIDE` squared texels of a byte a channel,
 * each channel of each texel the noise of its own index — `grainNoise` of the texel's channel
 * counted from 1 — taken from [−1, 1] to [0, 1], so that texels are independent and the texture
 * repeats without a seam. `decode` is what the reference reduces the texture to for the same
 * purpose: the number of texels over the sum of a channel, so that the texture times it has a
 * mean of 1 and the grain neither brightens nor darkens the image.
 */
export function grainTexels(): GrainTexels {
  if (cached) return cached
  const count = GRAIN_TEXTURE_SIDE * GRAIN_TEXTURE_SIDE
  const bytes = new Uint8Array(count * CHANNELS)
  const sums = [0, 0, 0]
  for (let texel = 0; texel < count; texel++) {
    for (let channel = 0; channel < 3; channel++) {
      const byte = unorm8(0.5 + 0.5 * grainNoise(texel * 3 + channel + 1))
      bytes[texel * CHANNELS + channel] = byte
      sums[channel] += byte / 255
    }
    bytes[texel * CHANNELS + 3] = 255
  }
  const [r, g, b] = sums.map((sum) => count / sum)
  return (cached = { bytes, decode: [r, g, b] })
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
