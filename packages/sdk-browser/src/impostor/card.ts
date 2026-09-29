/**
 * THE CARD QUAD (#1239, fact 2). The impostor card is a camera-facing quad, exactly the per-page
 * mechanism sprites already use: the shared `spriteAt` basis (`visibility/shader/spriteWgsl.ts`),
 * never a second quad builder. Its half-extent is the root's world radius `R`, so the card covers
 * the object's projected disc, and it keeps its world size (attenuation on) rather than its screen
 * size, as a distant stand-in must.
 */
import { spriteAt } from '../visibility/shader/spriteWgsl.ts';
import type { VisMaterial } from '../visibility/types.ts';

const CARD_SPRITE: NonNullable<VisMaterial['sprite']> = { rotation: 0, sizeAttenuation: true };

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
  const place = new Float64Array(16);
  place[0] = place[5] = place[10] = place[15] = 1;
  place[12] = pivot[0];
  place[13] = pivot[1];
  place[14] = pivot[2];
  const corner = new Float64Array(4),
    sides = [-radius, -radius, radius, -radius, radius, radius, -radius, radius];
  for (let i = 0; i < 4; i++) {
    spriteAt(corner, toClip, place, sides[2 * i], sides[2 * i + 1], CARD_SPRITE);
    out[i * 3] = corner[0];
    out[i * 3 + 1] = corner[1];
    out[i * 3 + 2] = corner[2];
  }
  return out;
}
