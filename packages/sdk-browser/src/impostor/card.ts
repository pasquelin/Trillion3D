/**
 * THE CARD QUAD (fact 2). The impostor card is a camera-facing quad, exactly the per-page
 * mechanism sprites already use: the shared `spriteAt` basis (`visibility/shader/spriteWgsl.ts`),
 * never a second quad builder. Its half-extent is the root's world radius `R`, so the card covers
 * the object's projected disc, and it keeps its world size (attenuation on) rather than its screen
 * size, as a distant stand-in must.
 */
import { copyMatrix4, IDENTITY_MATRIX4 } from '../../../math/src/matrix/matrix4.ts'
import { core } from './borrowed.ts'
import type { VisMaterial } from '../visibility/types.ts'

const CARD_SPRITE: NonNullable<VisMaterial['sprite']> = { rotation: 0, sizeAttenuation: true }
/** The corner signs in call order, scaled by `radius`: `(-R,-R)`, `(+R,-R)`, `(+R,+R)`, `(-R,+R)`. */
const CARD_SIDES = [-1, -1, 1, -1, 1, 1, -1, 1]
// The card is drawn per frame: the placement and the corner it reads stay, no allocation per call.
const cardPlace = copyMatrix4(new Float64Array(16), IDENTITY_MATRIX4)
const cardCorner = new Float64Array(4)

/**
 * The four corners of the impostor card, as points in the space `toClip` projects from, into `out`
 * at `corner * 3`, counter-clockwise from the lower left: `(-R,-R)`, `(+R,-R)`, `(+R,+R)`,
 * `(-R,+R)`. `pivot` is the card's centre in that space, the root's world pivot; `radius` is `R`.
 */
export function impostorCardCorners(
  out: Float64Array,
  toClip: ArrayLike<number>,
  pivot: ArrayLike<number>,
  radius: number,
) {
  cardPlace[12] = pivot[0]
  cardPlace[13] = pivot[1]
  cardPlace[14] = pivot[2]
  for (let i = 0; i < 4; i++) {
    core.spriteAt(
      cardCorner,
      toClip,
      cardPlace,
      CARD_SIDES[2 * i] * radius,
      CARD_SIDES[2 * i + 1] * radius,
      CARD_SPRITE,
    )
    out[i * 3] = cardCorner[0]
    out[i * 3 + 1] = cardCorner[1]
    out[i * 3 + 2] = cardCorner[2]
  }
  return out
}
