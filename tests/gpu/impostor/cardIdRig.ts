import { CARD_VIEW_FLOATS } from '../../../packages/sdk-browser/src/webgpu/impostor/cardWgsl.ts'
import { DEG2RAD } from '../../../packages/math/src/constants.ts'
import { CARD_FLOATS } from '../../../packages/sdk-browser/src/impostor/cardSlots.ts'
import { bufferHolding } from '../kit/computeReadback.ts'
import { CARD_MAPS, cardTileAtlases, chainOf } from './cardTileRig.ts'

// The rig of the card identifier proof (`cardIdPage.ts`): the view, the records, the maps in the
// tile pool, the readback.

export const SIDE = 64
const FRAMES = 4,
  ATLAS = 16
/** The card is turned about x so that the eye, in its object space, looks from above: inside the upper
 *  hemi-octahedron the atlas covers, whose frames' planes the eye's ray crosses. */
const TURN = -40 * DEG2RAD
/** The depth the visibility stage's view is given beyond the surface stage's: 2⁻¹⁸ of it. */
export const DEPTH_SKEW = 2 ** -18

/** Perspective of 60° and an aspect of one, reversed depth with an infinite far plane (clip z is the
 *  near distance, clip w the distance): a point at distance d reads depth near / d, nearer larger.
 *  Column-major. `skew` scales the clip z alone, as a compiler rounding the depth apart would. */
function projection(skew: number) {
  const f = 1 / Math.tan(30 * DEG2RAD),
    near = 0.1
  return [f, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, -1, 0, 0, near * skew, 0]
}

/** A view uniform (`CardView`): the view-projection and the camera's own — one, the camera at the
 *  origin and turned to −z —, the eye split in two singles (zero), the focal length's logarithm. */
export function viewUniform(device: GPUDevice, skew: number) {
  const data = new Float32Array(CARD_VIEW_FLOATS)
  data.set(projection(skew), 0)
  data.set(projection(1), 16)
  return bufferHolding(device, data, GPUBufferUsage.UNIFORM)
}

/** The records of cards at `centres` (z, radius), each a mesh of unit object radius whose pivot is
 *  its origin: the world is `radius`, the translation `(0, 0, z)`; card `k` reads colour map `k`
 *  (`CARD_MAPS`). */
export function cardRecords(device: GPUDevice, cards: Array<{ z: number; radius: number }>) {
  const data = new Float32Array(CARD_FLOATS * cards.length)
  cards.forEach(({ z, radius }, slot) => {
    const at = slot * CARD_FLOATS
    const c = Math.cos(TURN),
      sn = Math.sin(TURN)
    // The world is the turn's transpose scaled by the radius, translated; the inverse its opposite.
    data.set(
      [radius, 0, 0, 0, 0, radius * c, -radius * sn, 0, 0, radius * sn, radius * c, 0, 0, 0, z, 1],
      at,
    )
    data.set(
      [
        1 / radius,
        0,
        0,
        0,
        0,
        c / radius,
        sn / radius,
        0,
        0,
        -sn / radius,
        c / radius,
        0,
        0,
        0,
        0,
        1,
      ],
      at + 20,
    )
    // Object radius, frames a side, the upper hemi-octahedron, a texel depth that asks mip 0.
    data.set([1, FRAMES, 1, 8], at + 36)
    data.set([0, 0, 0, radius], at + 40)
    data.set([...CARD_MAPS(slot), 0], at + 44)
  })
  return bufferHolding(device, data, GPUBufferUsage.STORAGE)
}

/** The tile pool holding one colour and coverage map per colour of `colours`, one colour in all
 *  its frames (sRGB), a flat normal at the middle depth and the packed ORM: its group in `layout`. */
export function cardTiles(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  sampler: GPUSampler,
  colours: Array<[number, number, number]>,
) {
  const flat = (texel: number[]) => chainOf(ATLAS, Math.log2(ATLAS) + 1, () => texel)
  return cardTileAtlases(device, layout, sampler, {
    colours: colours.map((colour) => flat([...colour, 255])),
    normalDepth: flat([128, 128, 255, 128]),
    orm: flat([255, 128, 0, 255]),
  })
}

/** Half-float to number. */
export function half(bits: number) {
  const exponent = (bits >> 10) & 31,
    fraction = bits & 1023,
    sign = bits & 0x8000 ? -1 : 1
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 31) return fraction ? NaN : sign * Infinity
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}
