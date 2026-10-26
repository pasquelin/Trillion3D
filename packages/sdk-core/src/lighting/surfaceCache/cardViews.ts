import { DISTANCE_FIELD_UNITS_PER_METRE as CM } from '../../contracts/distanceFieldAbi.ts'
import type { AtlasRect } from './captures.ts'
import type { Card } from './cardTypes.ts'

/**
 * THE VIEW A CARD'S PAGE IS CAPTURED FROM: an orthographic view along the card's depth axis, from
 * outside the mesh, whose picture is the part of the card the page covers. The view sees the box of
 * the card whole: its near plane is the card's outer face, its far plane the inner one, so the
 * depth it writes is the card's own (`depth` 1 at the outer face, 0 at the inner one, as the engine's
 * reversed depth reads).
 *
 * The page is the rectangle `uv` (`x0, y0, x1, y1`) of the card's UV, the card's width along its
 * first axis and its height along its second, the first row of the picture at the top of the card
 * (`v` 0). Its clip space maps the page onto the whole of [-1, 1] in x and y, and the card's depth
 * onto [0, 1]: `clip = M · (p - anchor)` for a world point `p` in metres, `M` the matrix `viewProjection`
 * holds by column. The anchor is the card's centre, so that a matrix of floats holds a card far from the
 * origin to the same precision as one near it.
 *
 * The card's three axes make a left-handed frame (`axisX = axisZ × axisY`), so the view MIRRORS the world:
 * the winding of a triangle on its picture is the opposite of the one a camera that looks along
 * `-axisZ` would see. A raster that culls by winding takes it into account; a card is captured as its
 * surface is, whichever side of a triangle faces the view.
 */

/** The view of one page of a card. */
export interface CardView {
  /** The card's centre in metres: the point the matrix is relative to. */
  readonly anchor: readonly [number, number, number]
  /** World metres minus the anchor to the page's clip space, by column. */
  readonly viewProjection: Float64Array
  /** Where the page's picture goes in the capture atlas, in texels. */
  readonly rect: AtlasRect
}

/** The orthographic view of the page of `card` covering `uv` of it, picturing into `rect` of the
 *  capture atlas. */
export function cardPageView(
  card: Card,
  uv: readonly [number, number, number, number],
  rect: AtlasRect,
): CardView {
  const [u0, v0, u1, v1] = uv
  const half = [card.extent[0] / CM, card.extent[1] / CM, card.extent[2] / CM]
  const xHalf = (u1 - u0) * half[0],
    yHalf = (v1 - v0) * half[1],
    zHalf = 2 * half[2]
  const xCentre = (u0 + u1 - 1) * half[0],
    yCentre = -(v0 + v1 - 1) * half[1]
  const m = new Float64Array(16)
  for (let j = 0; j < 3; j++) {
    m[j * 4] = card.axisX[j] / xHalf
    m[j * 4 + 1] = card.axisY[j] / yHalf
    m[j * 4 + 2] = card.axisZ[j] / zHalf
  }
  m[12] = -xCentre / xHalf
  m[13] = -yCentre / yHalf
  m[14] = 0.5
  m[15] = 1
  return {
    anchor: [card.origin[0] / CM, card.origin[1] / CM, card.origin[2] / CM],
    viewProjection: m,
    rect,
  }
}
