import { createRequestLoop } from './requestLoop.ts'
import { createWorldContents } from './contents.ts'
import { createWorldLights } from './lights.ts'
import { createWorldLink } from './link.ts'
import { createWorldBackground } from './background.ts'
import { watchFirstFrame } from '../openWatch.ts'
import { worldReopens } from './reopen.ts'
import { followPageCamera } from './camera.ts'
import { namedMove } from './sceneMethods.ts'
import type { WorldRuntimeInputs } from './runtimeInputs.ts'
import { askedFrame } from './frames/askedFrame.ts'
import type { FrameMetrics } from '../../../../sdk-core/src/contracts/metrics.ts'
import {
  worldApply,
  worldOpening,
  type WorldReopens,
  type WorldRuntimeParts,
  type WorldRuntimeState,
} from './runtimeParts.ts'

/** The session drawing a world, fed by a per-frame change list: what the scene asks is resolved
 *  off the frame (`contents.ts`), applied once before each frame — rows taken, parked or grown
 *  (`placement/growth/growth.ts`), models and their partitions joined (`models/modelJoin.ts`), poses,
 *  background —; and opened again for a lost device or an option alone (`reopen.ts`). */
export function createWorldRuntime(inputs: WorldRuntimeInputs) {
  const { canvas, scene, camera } = inputs
  const contents = createWorldContents(scene, inputs.diagnostic.notices),
    lights = createWorldLights(scene),
    background = createWorldBackground(scene)
  const placeCamera = followPageCamera(camera, canvas)
  const track = worldReopens(
    canvas,
    inputs.diagnostic.notices,
    () => reopens.request(),
    () => inputs.options().pageCache?.pageCount ?? 0,
  )
  const state: WorldRuntimeState = {
    explorer: null,
    seatWanted: false,
    lightsChanged: true,
    disposed: false,
    closed: 'the scene has not been read yet',
  }
  const invalidate = () => state.explorer?.invalidate()
  // A move by name through the session (#972), and the one the world offers its page.
  const moveNamed = namedMove(scene, contents.poses, invalidate)
  const relight = () => ((state.lightsChanged = true), invalidate())
  // A world its page leads follows its canvas before each frame; a session's own loop, itself.
  const led = inputs.options().interactive === false
  const parts: WorldRuntimeParts = {
    ...{ inputs, state, contents, lights, background, track, led, placeCamera, moveNamed },
    // The scene's resolutions: one pass at a time, a burst one pass (`worldResolution`).
    resolves: createRequestLoop(() => resolution()),
    invalidate,
  }
  const reopens = createRequestLoop(worldOpening(parts))
  const apply = worldApply(parts, reopens)
  const resolution = worldResolution(parts, reopens, apply)
  const schedule = () => parts.resolves.request()
  const frame = worldFrame(parts, apply)
  // A scene holding something that has drawn nothing says why, once (`openWatch.ts`).
  watchFirstFrame(() => {
    if (inputs.drawn() || state.disposed || !scene.children.length) return null
    return state.explorer
      ? 'its session is open and draws nothing'
      : `no session has opened, ${state.closed}`
  })
  scene._link = createWorldLink({ contents, lights, invalidate, relight, schedule })
  return runtimeHandle(parts, reopens, frame, relight)
}

/** A pass of the scene's resolution, once the device is granted: what changed is resolved, and
 *  again while some is stale; a change made meanwhile asks the next pass; a throw ends the pass. */
function worldResolution(parts: WorldRuntimeParts, reopens: WorldReopens, apply: () => void) {
  const { inputs, state, contents, invalidate } = parts
  // A mesh whose resource landed is seated at the next frame, or opens the first session.
  const landed = () => {
    state.seatWanted = true
    if (!state.explorer && !reopens.running) apply()
    invalidate()
  }
  return async () => {
    await inputs.ready().catch(() => {})
    try {
      while (!state.disposed) {
        if (await contents.resolve(landed)) state.lightsChanged = true
        landed()
        if (!contents.staleCount) break
      }
    } catch (error) {
      state.closed = 'the scene could not be resolved'
      state.lightsChanged = true // a light taken with the burst that threw is written all the same
      if (!state.disposed)
        inputs.diagnostic.failed(new Error('World scene resolution failed', { cause: error }))
    }
  }
}

/** THE WORLD'S FRAME, whoever leads it: `beforeFrame` steps (`ahead`), applies every change since
 *  the last frame and follows the canvas and camera; `afterDraw` hands the metrics on — the
 *  dynamic uploads told, a reopen said, the world's hooks run. The session's own loop calls both
 *  around its draw; `draw`, the frame `render` asks, calls them around its own. */
function worldFrame(parts: WorldRuntimeParts, apply: () => void) {
  const { inputs, state, contents, track, led, placeCamera } = parts
  const beforeFrame = (ahead?: () => void) => {
    ahead?.()
    apply()
    if (!state.explorer) return
    if (led) state.explorer.followCanvas()
    placeCamera(state.explorer.camera)
  }
  const afterDraw = (metrics: FrameMetrics) => {
    contents.cuts.dynamic.drew(metrics)
    track.drew()
    inputs.frame(metrics)
  }
  const draw = (ahead?: () => void) => {
    if (!state.explorer) return null
    beforeFrame(ahead) // what it applies may close the session: that frame has no image
    if (!state.explorer) return null
    const metrics = state.explorer.render()
    afterDraw(metrics)
    return metrics
  }
  return { beforeFrame, afterDraw, draw }
}

/** What a world reads of its runtime. */
function runtimeHandle(
  parts: WorldRuntimeParts,
  reopens: WorldReopens,
  { beforeFrame, afterDraw, draw }: ReturnType<typeof worldFrame>,
  relight: () => void,
) {
  const { inputs, state, contents, track } = parts
  const { canvas, scene } = inputs
  return {
    beforeFrame,
    afterDraw,
    invalidate: parts.invalidate,
    /** A move by name the world offers its page (`world.setTransform`, #972). */
    moveNamed: parts.moveNamed,
    /** A session option changed, or the device was lost (`at` the loss): the next opening takes
     *  it, and its notice measures from `at`. */
    renew: track.request,
    /** Whether a session is open or opening. */
    get holdsSession() {
      return state.explorer !== null || reopens.running !== null
    },
    /** Settles once `session` has closed: what waited on it carries on with the next one. */
    ended: track.ended,
    /** Exposure or curve changed: written with the lights before the next frame. */
    displayChanged: relight,
    get explorer() {
      return state.explorer
    },
    /** Settles once the session reflects every change made so far. */
    async settled() {
      const { resolves } = parts
      while (resolves.running || reopens.running || contents.joining)
        await (resolves.running ?? reopens.running ?? contents.joining)
      await state.explorer?.familiesPending() // a family on its way: a change not drawn yet
    },
    /** A frame, `ahead` stepping first: drawn now, or once the world can (`frames/askedFrame.ts`). */
    render: askedFrame({
      // The session opening, or the families the frame draws with on their way (`familyUse.ts`).
      waits: () =>
        state.explorer
          ? state.explorer.familiesPending()
          : (parts.resolves.running ?? reopens.running),
      draw,
      closed: () => state.disposed,
      // Drawn past the page's call: said, and reported as an uncaught error is (`interactive.ts`).
      failed(error) {
        console.error('[trillion3d] A frame asked by world.render() failed', error)
        canvas.ownerDocument?.defaultView?.reportError?.(error)
      },
    }),
    dispose() {
      state.disposed = true
      state.explorer?.dispose()
      track.dispose(state.explorer)
      contents.cuts.dispose()
      contents.dispose()
      scene.traverse((node) => (node._link = null))
    },
  }
}
