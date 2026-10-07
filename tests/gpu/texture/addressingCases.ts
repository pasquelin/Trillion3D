// Texel addressing cases (defects 4 and 7) and the sampler rule they are held to.
//
// A host hands a map's wrap mode to the GPU sampler: repeat, clamp to edge, mirrored repeat. The
// reference is the WebGPU sampler's own rule:
// i = ⌊u·size⌋, then clamp, modulo, or modulo over two periods whose second is read backwards.
// `texture-addressing.gpu.ts` checks that rule against the real samplers, case by case, and the
// engine's wrap WGSL against both.
import {
  HOST_WRAP_CLAMP_TO_EDGE,
  HOST_WRAP_MIRRORED_REPEAT,
  HOST_WRAP_REPEAT,
} from '../../../packages/sdk-browser/src/host/surfaceConstants.ts'

/** The three host wrap modes, by name. */
const MODES: [string, number][] = [
  ['ClampToEdge', HOST_WRAP_CLAMP_TO_EDGE],
  ['Repeat', HOST_WRAP_REPEAT],
  ['MirroredRepeat', HOST_WRAP_MIRRORED_REPEAT],
]

/** The WebGPU address mode a sampler set to each host wrap mode takes. */
export const ADDRESS_MODE = new Map<number, GPUAddressMode>([
  [HOST_WRAP_CLAMP_TO_EDGE, 'clamp-to-edge'],
  [HOST_WRAP_REPEAT, 'repeat'],
  [HOST_WRAP_MIRRORED_REPEAT, 'mirror-repeat'],
])

/** Half a level in 255: the weight quantisation the sampler is allowed. */
export const TOLERANCE = 0.5

/** Texel index `i` brought back into the image by the wrap mode alone. */
function wrapIndex(i: number, size: number, wrap: number) {
  if (wrap === HOST_WRAP_CLAMP_TO_EDGE) return Math.min(size - 1, Math.max(0, i))
  const period = wrap === HOST_WRAP_REPEAT ? size : 2 * size
  const j = ((i % period) + period) % period
  return j < size ? j : period - 1 - j
}

/** The texel nearest-neighbour sampling keeps on an axis of `size` texels. */
export function nearestTexel(t: number, size: number, wrap: number) {
  return wrapIndex(Math.floor(t * size), size, wrap)
}

/**
 * The two texels linear filtering blends on an axis, and the weight of the second: the coordinate
 * shifted by half a texel gives the low index, and each of the two indices takes the wrap mode for
 * itself (§ 3.8.10). Under repeat, the two indices of a period seam are therefore the last texel
 * and the first, which wrapping the coordinate would split.
 */
export function linearTexels(t: number, size: number, wrap: number): [number, number, number] {
  const c = t * size - 0.5,
    low = Math.floor(c)
  return [wrapIndex(low, size, wrap), wrapIndex(low + 1, size, wrap), c - low]
}

/** The byte the two blended texels yield on their axis: red = 20 + 40x, green = 20 + 40y. */
const blendedByte = ([i0, i1, weight]: [number, number, number]) =>
  (20 + 40 * i0) * (1 - weight) + (20 + 40 * i1) * weight

/** The rule's exact colour on an axis, the two texels blended, in [0, 1]. */
export const ruleColour = (t: number, size: number, wrap: number) =>
  blendedByte(linearTexels(t, size, wrap)) / 255

/**
 * A period seam: under repeat the two blended texels are not neighbours in the image, one is the
 * last and the other the first. Clamp and mirror read the same edge texel twice there, which
 * wrapping the coordinate already yields: they have no seam.
 */
export const onSeam = (t: number, size: number, wrap: number) => {
  if (wrap !== HOST_WRAP_REPEAT) return false
  const [i0, i1] = linearTexels(t, size, wrap)
  return i1 !== i0 + 1
}

/** Whether the coordinate falls, to 1e-3 texel, on the boundary of two texels. */
const onBoundary = (t: number, size: number) => Math.abs(t * size - Math.round(t * size)) < 1e-3

/**
 * Coordinates of an axis of `size` texels, rounded to 32-bit floats as the GPU receives them:
 * integers, texel centres, boundaries, negatives, neighbours of 0 and 1, and large ones (±1e3) on
 * both period parities.
 */
function coordinates(size: number) {
  const out = [-1001, -1000, -3, -2, -1, 0, 1, 2, 3, 1000, 1001, 0.999, -0.001, 1.001, -0.999]
  for (const p of [-3, -2, -1, 0, 1, 2])
    for (let k = 0; k < size; k++) out.push(p + (k + 0.5) / size)
  for (const p of [-2, -1, 0, 1]) for (let k = 1; k < size; k++) out.push(p + k / size)
  for (const p of [-1001, -1000, 1000, 1001])
    for (let k = 0; k < size; k++) out.push(p + (k + 0.5) / size)
  return out.map(Math.fround)
}

/** The other axis, fixed off a boundary at 1.3: the three modes read three different texels. */
const OTHER_AXIS = Math.fround(1.3)

/** Test textures, one even and one odd size on each axis. */
export const SIZES: [number, number][] = [
  [4, 5],
  [5, 4],
]

/** A texture's RGBA bytes, every component of every texel distinct: texel (x, y) is red 20 + 40x,
 *  green 20 + 40y, alpha 10 + 10·rank. */
export function textureBytes(width: number, height: number) {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      data.set([20 + 40 * x, 20 + 40 * y, 0, 10 + 10 * (y * width + x)], (y * width + x) * 4)
  return data
}

/** One addressing case: a coordinate on the probed axis, the other fixed, and the rule's texel. */
export interface AddressingCase {
  width: number
  height: number
  nameS: string
  nameT: string
  wrapS: number
  wrapT: number
  u: number
  v: number
  /** Whether the probed coordinate falls on the boundary of two texels. */
  boundary: boolean
  expected: [number, number]
}

/** Every case: each size, each probed axis, each pair of modes (S, T), the probed coordinate over
 *  `coordinates`, the other at `OTHER_AXIS`. `expected` is the rule's texel (x, y). */
export function addressingCases(): AddressingCase[] {
  const out: AddressingCase[] = []
  for (const [width, height] of SIZES)
    for (const axis of ['u', 'v'] as const) {
      const size = axis === 'u' ? width : height
      for (const [nameS, wrapS] of MODES)
        for (const [nameT, wrapT] of MODES)
          for (const t of coordinates(size)) {
            const u = axis === 'u' ? t : OTHER_AXIS,
              v = axis === 'v' ? t : OTHER_AXIS
            out.push({
              width,
              height,
              nameS,
              nameT,
              wrapS,
              wrapT,
              u,
              v,
              boundary: onBoundary(t, size),
              expected: [nearestTexel(u, width, wrapS), nearestTexel(v, height, wrapT)],
            })
          }
    }
  return out
}
