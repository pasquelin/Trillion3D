// `SPRITE_WGSL` on the CPU, for the proofs that read a sprite's corner off the GPU's text.
import type { VisMaterial } from '../materialType.ts'
import { length3, transformPointRow } from '../../../../math/src/vector/vector.ts'

/** `SPRITE_WGSL` on the CPU, statement for statement: the impostor card's corner
 *  (`../../impostor/card.fixture.ts`). Both matrices are column-major; writes the point, `w` one, into
 *  `out` and returns it. */
export function spriteAt(
  out: Float64Array,
  toClip: ArrayLike<number>,
  place: ArrayLike<number>,
  cornerX: number,
  cornerY: number,
  sprite: NonNullable<VisMaterial['sprite']>,
) {
  let ax = cornerX * length3(place[0], place[1], place[2]),
    ay = cornerY * length3(place[4], place[5], place[6])
  if (!sprite.sizeAttenuation) {
    const w = transformPointRow(toClip, 3, place[12], place[13], place[14])
    ax *= w
    ay *= w
  }
  const c = Math.cos(sprite.rotation),
    s = Math.sin(sprite.rotation)
  const r = length3(toClip[0], toClip[4], toClip[8]),
    u = length3(toClip[1], toClip[5], toClip[9])
  const x = c * ax - s * ay,
    y = s * ax + c * ay
  for (let i = 0; i < 3; i++)
    out[i] = place[12 + i] + (x * toClip[4 * i]) / r + (y * toClip[4 * i + 1]) / u
  out[3] = 1
  return out
}
