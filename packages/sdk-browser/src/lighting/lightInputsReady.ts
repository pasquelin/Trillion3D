import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { shadowsUnsettled } from '../frame/backend/state/lights.ts'
import { shadowsOn } from './shadows/vsm/frame/vsmGates.ts'

/**
 * WHETHER THE INPUTS THE LIGHT IS MADE OF ARE READY: the shadows landed and the coarse level of the textures the cards read in. The one rule of what accumulates light — the
 * surface cache's lighting and radiosity (`surfaceCache/lighting/frame.ts`), the screen probes' history (`bounce/screen/historyReady.ts`) —:
 * nothing enters a history before them, so that none keeps a residue of the instant they came, and the settling counts from their arrival. The scene's objects are among them:
 * one whose material class still compiles is drawn out of the image, and no history is made of an image that lacks it.
 */
export function lightInputsReady(
  rt: Pick<WebgpuPagesRuntime, 'lights' | 'vis' | 'run' | 'context' | 'gpu'>,
) {
  const { store, vsm } = rt.lights
  // A scene that holds a shadowed light but whose shadow maps are not yet made has its shadows still to come: `shadowsUnsettled` answers
  // "settled" for lack of maps, and the light would begin without them. Maps come only if the shadows run (`shadowsOn`) and the pool was not
  // refused (`lights.vsmRefusal`): with them cut or refused, none will exist and the light does not wait for them.
  const mapsToCome =
    store.shadowedSuns + store.shadowedLocals > 0 &&
    !store.unlit &&
    !vsm &&
    shadowsOn(rt) &&
    !rt.lights.vsmRefusal
  return (
    !mapsToCome &&
    !shadowsUnsettled(rt.lights) &&
    // The coarse level of the textures the cards read, never the finer tiles the view asks for as it moves: a moving camera over a streamed world has some pending all the time.
    !rt.vis.textures?.counters.pendingCoarse &&
    !rt.run.textureConverging
  )
}
