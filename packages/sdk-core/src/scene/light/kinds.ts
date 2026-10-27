import { DEFAULT_LIGHTING_CHANNELS_MASK } from '../../contracts/lightingChannelsAbi.ts'
import type { SceneLight } from './contracts.ts'
import { lightingChannelMaskOf } from './fields.ts'
import { castsContactShadow, type ContactShadowView } from './contactShadowView.ts'
import type { LightShadowView } from './shadowedBits.ts'

/**
 * A light store's lights by what the lit programs key on: the suns and the local lights, those that
 * cast a shadow, rectangles, those that ask for a contact shadow, those in a lighting channel set other
 * than the default's, those that name a light profile. `tally` counts a light in (`by` 1) or out (`by` −1) at every add, change and
 * removal of the store (`./store.ts`): `counts` reads them in O(1), never a walk of the store.
 */
export function createLightKinds(view: ContactShadowView, shadows: LightShadowView) {
  let suns = 0,
    locals = 0,
    shadowedSuns = 0,
    shadowedLocals = 0,
    rects = 0,
    contacts = 0,
    channelled = 0,
    profiled = 0
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
      /** The lights that cast a contact shadow of their own under the view: they cast a shadow and
       *  their length, the view's override included, is above 0 (`castsContactShadow`). */
      get contacts() {
        return contacts
      },
      /** The lights in a lighting channel set other than the default's (channel 0 alone). */
      get channelled() {
        return channelled
      },
      /** The lights that name a light profile (`SceneLight.iesProfile`): the programs bind the profile atlas only past 0. */
      get profiled() {
        return profiled
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
      if (castsContactShadow(light, view, shadows)) contacts += by
      if (lightingChannelMaskOf(light) !== DEFAULT_LIGHTING_CHANNELS_MASK) channelled += by
      if (light.iesProfile !== undefined) profiled += by
    },
    /** `contacts` again, over `lights`, after the view's settings moved. */
    recountContacts(lights: Iterable<SceneLight>) {
      contacts = 0
      for (const light of lights) if (castsContactShadow(light, view, shadows)) contacts++
    },
  }
}
