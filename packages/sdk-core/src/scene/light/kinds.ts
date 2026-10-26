import type { SceneLight } from './contracts.ts'

/**
 * A light store's lights by what the lit programs key on: the suns and the local lights, those that
 * cast a shadow, rectangles. `tally` counts a light in (`by` 1) or out (`by` −1) at every add, change
 * and removal of the store (`./store.ts`): `counts` reads them in O(1), never a walk of the store.
 */
export function createLightKinds() {
  let suns = 0,
    locals = 0,
    shadowedSuns = 0,
    shadowedLocals = 0,
    rects = 0
  return {
    /** The counts, as accessors: `joined` keeps them so on the store. */
    counts: {
      /** The directional lights: what the sun's pass walks. */
      get suns() {
        return suns
      },
      /** The point, spot and rectangle lights: what the local lights' pass walks. */
      get locals() {
        return locals
      },
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
      const sun = light.kind === 'directional'
      if (sun) suns += by
      else locals += by
      if (light.castsShadow) {
        if (sun) shadowedSuns += by
        else shadowedLocals += by
      }
      if (light.kind === 'rect') rects += by
    },
  }
}
