import type { CardSegment } from './cardSlots.ts'
import type { CardAsk } from '../webgpu/tile/cardTiles.ts'

/** Levels the ask widens on either side, past f32's rounding of the card's own level: a level the
 *  shader may read is never one the ask leaves out. */
const LEVEL_SLACK = 1 / 1024

const ask: CardAsk = { from: 0, to: 0, pixels: 0 }

/**
 * What the cards of `segment` read of its maps, seen from `eye` at focal length `focal` in pixels:
 * the level of a card is the card pass's (`card_vs`), the logarithm of its distance over the depth
 * of one texel at unit focal length, `log2(d · frameSide / (2R · f))`, at least 0. Over the
 * segment's box — its roots' pivot spheres — and their least and largest radius, the nearest point
 * with the largest radius bounds the finest level any card reads, the farthest corner with the
 * least radius the coarsest; the blend mixes in one more. A bound, never a card's own level: what a
 * card reads is always asked, at O(1) a segment however many cards it holds. The pixels are the
 * nearest card's disc at most, `π (f R / d)²`, the eye inside the box counted at `d = R`. Returns
 * one record, reused.
 */
export function cardAsk(segment: CardSegment, eye: ArrayLike<number>, focal: number) {
  const { box, radii } = segment,
    side = segment.entry.frameSide
  let near = 0,
    far = 0
  for (let k = 0; k < 3; k++) {
    const e = eye[k],
      low = box[k],
      high = box[k + 3]
    const gap = e < low ? low - e : e > high ? e - high : 0,
      reach = Math.max(Math.abs(e - low), Math.abs(e - high))
    near += gap * gap
    far += reach * reach
  }
  near = Math.sqrt(near)
  far = Math.sqrt(far)
  const level = (distance: number, radius: number) =>
    Math.log2((distance * side) / (2 * radius * focal))
  ask.from = Math.max(0, Math.floor(level(near, radii[1]) - LEVEL_SLACK))
  ask.to = Math.max(0, Math.floor(level(far, radii[0]) + LEVEL_SLACK)) + 1
  const disc = (focal * radii[1]) / Math.max(near, radii[1])
  ask.pixels = Math.PI * disc * disc
  return ask
}
