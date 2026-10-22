import type { SceneLight } from './contracts.ts'

/**
 * A light store's lights by what the lit programs key on: suns casting a shadow, local lights
 * casting one, rectangles. `tally` counts a light in (`by` 1) or out (`by` −1) at every add, change
 * and removal of the store (`./store.ts`): `counts` reads them in O(1), never a walk of the store.
 */
export function createLightKinds() {
  let shadowedSuns = 0,
    shadowedLocals = 0,
    rects = 0
  return {
    /** The counts, as accessors: `joined` keeps them so on the store. */
    counts: {
      get shadowedSuns() {
        return shadowedSuns
      },
      get shadowedLocals() {
        return shadowedLocals
      },
      get rects() {
        return rects
      },
    },
    tally(light: SceneLight, by: 1 | -1) {
      if (light.castsShadow) {
        if (light.kind === 'directional') shadowedSuns += by
        else shadowedLocals += by
      }
      if (light.kind === 'rect') rects += by
    },
  }
}
