import type { SceneLight } from './contracts.ts'

/**
 * A light store's lights by what the lit programs key on: suns casting a shadow, local lights
 * casting one, rectangles. `tally` counts a light in (`by` 1) or out (`by` −1) at every add, change
 * and removal of the store (`./store.ts`): read in O(1), never a walk of the store.
 */
export function createLightKinds() {
  const kinds = {
    shadowedSuns: 0,
    shadowedLocals: 0,
    rects: 0,
    tally(light: SceneLight, by: 1 | -1) {
      if (light.castsShadow) {
        if (light.kind === 'directional') kinds.shadowedSuns += by
        else kinds.shadowedLocals += by
      }
      if (light.kind === 'rect') kinds.rects += by
    },
  }
  return kinds
}
