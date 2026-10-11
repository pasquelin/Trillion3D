import type { CharacterBody } from '../../../../sdk-core/src/collision/characterSettings.ts'

/** The body of a character no physics holds: it stands where it was put, keys unheard. */
export function createRestingBody(): CharacterBody {
  const feet = new Float64Array(3)
  return {
    feet,
    velocity: new Float64Array(3),
    onGround: false,
    place: (x, y, z) => void feet.set([x, y, z]),
    pressJump() {},
    advance: () => feet,
  }
}
