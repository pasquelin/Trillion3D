import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { lightInputsReady } from '../../lightInputsReady.ts'

/**
 * WHETHER THE SCREEN PROBES' HISTORY MAY BEGIN: the light the probes gather is the light of the scene's surfaces — the surface cache's
 * cards, which their rays read at their hits — under its shadows and its textures. While one of them is still on its way, an image's
 * gather is not the scene's: a history accumulated from it keeps a residue that depends on the instant they came, which two worlds of
 * one scene do not share. The history therefore begins with its inputs ready — the shadows landed, the textures whole — and the cache's
 * lighting begun (its latch `begun`, which waits for the same inputs): not its establishment, which a moving camera never reaches. Once begun, as
 * the reference's, the history accumulates and rejects by pixel what changed.
 */
export function probeInputsReady(
  rt: Pick<WebgpuPagesRuntime, 'lights' | 'vis' | 'run' | 'context' | 'surfaceCache' | 'gpu'>,
) {
  const cache = rt.surfaceCache
  return lightInputsReady(rt) && (!cache || !!cache.lighting?.begun)
}

/**
 * The view's history after an image cast with its inputs `ready` (`probeInputsReady`): it begins at the first image with them ready — before, nothing is carried
 * and nothing counted — and, begun, is carried and counted whatever the inputs do after (a shadow redrawn, a card captured as the camera moves is the light
 * changing, which the history follows, not the light being unlit).
 */
export function followHistory(
  view: { history: boolean; frame: number; begun: boolean },
  ready: boolean,
) {
  view.begun ||= ready
  view.history = view.begun
  view.frame = view.begun ? view.frame + 1 : 0
}
