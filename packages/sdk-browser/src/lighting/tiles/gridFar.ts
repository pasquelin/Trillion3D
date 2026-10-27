import { LIGHT_KIND, LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { LIGHT_FIELD, baseOf } from '../../../../sdk-core/src/scene/light/fields.ts'
import type { SceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'

/** The farthest depth, in metres along the view axis `forward` from `eye`, a local light reaches:
 *  the depth of its centre plus its range, never under `gridFarFloor` or twice the near plane,
 *  never over `gridFarMax`; a directional light reaches no depth. */
export function lightGridFar(
  store: SceneLightStore,
  eye: ArrayLike<number>,
  forward: ArrayLike<number>,
  near: number,
) {
  const { packed, count } = store
  let far = Math.max(LIGHT_SETTINGS.gridFarFloor, 2 * near)
  for (let slot = 0; slot < count; slot++) {
    const base = baseOf(slot)
    if (store.kindOf(slot) === LIGHT_KIND.directional) continue
    const at = base + LIGHT_FIELD.position
    const depth =
      forward[0] * (packed[at] - eye[0]) +
      forward[1] * (packed[at + 1] - eye[1]) +
      forward[2] * (packed[at + 2] - eye[2])
    far = Math.max(far, depth + packed[base + LIGHT_FIELD.range])
  }
  return Math.min(far, LIGHT_SETTINGS.gridFarMax)
}
