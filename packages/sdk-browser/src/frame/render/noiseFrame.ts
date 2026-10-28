import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/**
 * THE NOISE'S CLOCK: the image number the noise of an image is indexed by — the blue noise's frame, the shading's, the finish's grain, the clouds', the
 * atmosphere's, the fog's and the sky occlusion's temporal index, the lighting's phase of a view with no temporal state (`lightingPhase`).
 *
 * Not `run.frame`, the count of images since the opening, which a world that drew one more image while its programs compiled, or that moved a hundred images before it
 * stopped, does not share with one that did not. Two anchors, the later of which counts:
 * - the surface cache's light start (`SurfaceLightingState.begunAt`), zero before it — the view is not held meanwhile — where the light can begin at all;
 * - the last image on which the view changed (`viewMoved`: a camera, content, light or pose revision moved), once it stands still: the images of its establishment that follow
 *   are the same in a world that moved and in one that was set there, and the image it is held on, the last one drawn, meets the same noise (the dither at rest stays
 *   where it is). On an image that changes, the clock is the image number from the light's start (or the opening): it turns with the view, as it must.
 */
export function noiseFrame(rt: Pick<WebgpuPagesRuntime, 'run' | 'surfaceCache' | 'lights'>) {
  const { run } = rt
  const cache = rt.surfaceCache
  let start = 0
  if (cache) {
    const begunAt = cache.lighting?.begunAt
    // The light has not begun: zero while it will (the view is not held meanwhile), the image number where it never can — no light to light, so no latch to close.
    if (begunAt === undefined && lightCanBegin(rt)) return 0
    start = begunAt ?? 0
  }
  const view = viewMoved(run)
  return Math.max(0, run.frame - (view.moving ? start : Math.max(start, view.lastMoved)))
}

/** Per runtime: the image its clock was last asked on, whether the view changed on it, and the last image it changed on. */
const views = new WeakMap<object, { image: number; moving: boolean; lastMoved: number }>()

/** Whether the view changed on this image (a revision moved since the frame the gate kept), asked once an image; a change moves the last image it changed on. */
function viewMoved(run: WebgpuPagesRuntime['run']) {
  let state = views.get(run)
  if (!state) views.set(run, (state = { image: -1, moving: false, lastMoved: 0 }))
  if (state.image !== run.frame) {
    state.image = run.frame
    // The view changed on this image when a revision (scene, view, resources) moved since the frame the gate kept (`FrameHold.same`, `frame/revisions.ts`): not whether the hold
    // stands, which takes two identical frames after the change (`stable`) and so says "moving" on the last image drawn before the hold. A runtime with no gate, or a gate with no witness yet (a stub, a session before its first frame is kept), changes on every image.
    state.moving = !run.gate?.hold?.same(run.gate.revisions)
    if (state.moving) state.lastMoved = run.frame
  }
  return state
}

/** Whether the surface cache's light can begin in this session: it lights the scene's lights from their buffer, and a store with no lit light has none. */
const lightCanBegin = ({ lights }: Pick<WebgpuPagesRuntime, 'lights'>) =>
  !!lights?.buffer && !lights.store.unlit
