/**
 * THE KERNEL THE CONVOLUTION USES WHEN A PAGE GIVES NONE, drawn by a closed form of its own: how a
 * point of light spreads through a lens of six blades. A bright centre holds most of the light; the
 * rest is a haze that falls off as the cube of the distance, and three lines of light through the
 * centre — the diffraction of the blades' straight edges — that are thin and long, six spikes in
 * all. The picture is square, monochrome, its centre the brightest texel, its values in linear
 * radiance (`BloomKernelImage`).
 */
import { TAU } from '../../../../../../math/src/constants.ts'
import { length2 } from '../../../../../../math/src/vector/vector.ts'
import type { BloomKernelImage } from '../../../../../../sdk-core/src/contracts/bloomConvolutionOptions.ts'

/** The kernel's side in texels: enough for a spike a texel thin to be drawn. */
const DEFAULT_KERNEL_SIDE = 512
/** The share of the kernel's light that is spread rather than kept at the centre. */
const SPREAD_SHARE = 0.12
/** The haze's core radius, a share of the half-side: the light is flat inside it and falls as the cube
 *  of the distance past it. */
const HALO_RADIUS = 0.02
/** A spike's half-width and the distance over which it fades, shares of the half-side. */
const SPIKE_WIDTH = 0.004
const SPIKE_REACH = 0.1
/** A spike's strength against the haze at the centre, summed over the three lines. */
const SPIKE_GAIN = 0.35
/** The directions of the three lines of light, 60° apart. */
const DIRECTIONS = [0, TAU / 6, TAU / 3].map((a) => [Math.cos(a), Math.sin(a)] as const)
/** The distance from the centre, in texels, past which the haze is read to clamp the rest to. */
const HAZE_AT = 3

/** The scatter at the offset (`u`, `v`) from the centre, in half-sides: the haze and the spikes. */
function scatter(u: number, v: number) {
  const ring = (length2(u, v) / HALO_RADIUS) ** 2
  let light = (1 + ring) ** -1.5
  for (const [c, s] of DIRECTIONS) {
    const along = u * c + v * s,
      across = -u * s + v * c
    light += SPIKE_GAIN / ((1 + (across / SPIKE_WIDTH) ** 2) * (1 + (along / SPIKE_REACH) ** 2))
  }
  return light
}

/** The kernel of `side` × `side` texels. The centre is the texel (`side / 2`, `side / 2`). */
export function defaultBloomKernel(side = DEFAULT_KERNEL_SIDE): BloomKernelImage {
  const half = side / 2
  const field = new Float32Array(side * side)
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++)
      field[y * side + x] = scatter((x - half) / half, (y - half) / half)
  // The brightest haze beside the centre, which the light of the rest is counted held to.
  const haze = scatter(HAZE_AT / half, 0)
  let spread = 0
  for (let i = 0; i < field.length; i++) spread += Math.min(field[i], haze)
  const centre = haze + (spread * (1 - SPREAD_SHARE)) / SPREAD_SHARE
  field[half * side + half] = centre
  const pixels = new Float32Array(4 * field.length)
  for (let i = 0; i < field.length; i++) pixels.fill(field[i], 4 * i, 4 * i + 4)
  return { width: side, height: side, pixels }
}
