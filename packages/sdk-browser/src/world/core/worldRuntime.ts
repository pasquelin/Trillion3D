import { createRequestLoop } from './requestLoop.ts'
import { createWorldContents } from './worldContents.ts'
import { releaseWorldMirror } from './worldMirror.ts'
import { createWorldLights } from './worldLights.ts'
import { createWorldLink } from './worldLink.ts'
import { createWorldBackground } from './worldBackground.ts'
import { watchFirstFrame } from '../session/openWatch.ts'
import { worldReopens } from './worldReopen.ts'
import { createCanvasFit, followPageCamera } from './worldCamera.ts'
import { namedMove } from './worldSceneMethods.ts'
import type { WorldRuntimeInputs as Inputs } from './worldRuntimeInputs.ts'
import { askedFrame } from './worldAskedFrame.ts'
import {
  worldApply,
  worldOpening,
  type WorldReopens,
  type WorldRuntimeParts,
  type WorldRuntimeState,
} from './worldRuntimeParts.ts'

/** The session drawing a world, fed by a per-frame change list: what the scene asks is resolved
 *  off the frame (`worldContents.ts`), applied once before each frame — rows taken, parked or grown
 *  (`placement/growth.ts`), poses, background —, and opened again once per burst for what it
 *  lacks: a model, a resource it was not opened with, or what its engine cannot take in place. */
export function createWorldRuntime(inputs: Inputs) {
  const { canvas, scene, camera } = inputs
  const contents = createWorldContents(scene, inputs.diagnostic.notices),
    lights = createWorldLights(scene),
    background = createWorldBackground(scene)
  const placeCamera = followPageCamera(camera, canvas)
  const track = worldReopens(canvas, inputs.diagnostic.notices, () => reopens.request())
  const state: WorldRuntimeState = {
    explorer: null,
    mirror: null,
    twins: new Map(),
    resolving: null,
    structureChanged: false,
    seatWanted: false,
    lightsChanged: true,
    disposed: false,
    closed: 'the scene has not been read yet',
  }
  const invalidate = () => state.explorer?.invalidate()
  // A move by name through the session (#972), and the one the world offers its page.
  const moveNamed = namedMove(scene, contents.poses, invalidate)
  const relight = () => ((state.lightsChanged = true), invalidate())
  const fit = createCanvasFit(canvas, inputs.options().interactive === false)
  const parts: WorldRuntimeParts = {
    ...{ inputs, state, contents, lights, background, track, fit, placeCamera, moveNamed },
    invalidate,
  }
  const reopens = createRequestLoop(worldOpening(parts))
  const apply = worldApply(parts, reopens)
  const schedule = worldResolve(parts, reopens, apply)
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

/** Changes before the grant or during a resolution fold into the next; a throw ends the burst. */
function worldResolve(parts: WorldRuntimeParts, reopens: WorldReopens, apply: () => void) {
  const { inputs, state, contents, invalidate } = parts
  const resolve = async () => {
    try {
      while ((state.structureChanged || contents.staleCount) && !state.disposed) {
        state.structureChanged = false
        if (await contents.resolve()) state.lightsChanged = true
        state.seatWanted = true
        if (!state.explorer && !reopens.running) apply()
        invalidate()
      }
    } catch (error) {
      state.closed = 'the scene could not be resolved'
      state.lightsChanged = true // a light taken with the burst that threw is written all the same
      if (!state.disposed)
        inputs.diagnostic.failed(new Error('World scene resolution failed', { cause: error }))
    }
    state.resolving = null
  }
  return () => {
    state.structureChanged = true
    state.resolving ??= inputs.ready().then(resolve, resolve)
  }
}

/** Before a frame, every change applied and the canvas and camera followed; and the frame
 *  `render` draws: `ahead` steps, every change since the last frame is applied. */
function worldFrame(parts: WorldRuntimeParts, apply: () => void) {
  const { inputs, state, contents, track, fit, placeCamera } = parts
  const beforeFrame = () => {
    apply()
    if (!state.explorer) return
    fit.apply(state.explorer)
    placeCamera(state.explorer.camera)
  }
  const draw = (ahead?: () => void) => {
    if (!state.explorer) return null
    ahead?.()
    beforeFrame() // what it applies may close the session: that frame has no image
    if (!state.explorer) return null
    const metrics = state.explorer.render()
    contents.cuts.dynamic.drew(metrics)
    track.drew()
    inputs.frame(metrics)
    return metrics
  }
  return { beforeFrame, draw }
}

/** What a world reads of its runtime. */
function runtimeHandle(
  parts: WorldRuntimeParts,
  reopens: WorldReopens,
  { beforeFrame, draw }: ReturnType<typeof worldFrame>,
  relight: () => void,
) {
  const { inputs, state, contents, track } = parts
  const { canvas, scene } = inputs
  return {
    beforeFrame,
    invalidate: parts.invalidate,
    /** A move by name the world offers its page (`world.setTransform`, #972). */
    moveNamed: parts.moveNamed,
    /** A session option changed, or the device was lost: the next opening takes it. */
    renew: track.request,
    /** Settles once `session` has closed: what waited on it carries on with the next one. */
    ended: track.ended,
    /** Exposure or curve changed: written with the lights before the next frame. */
    displayChanged: relight,
    get explorer() {
      return state.explorer
    },
    /** Settles once the session reflects every change made so far. */
    async settled() {
      while (state.resolving || reopens.running) await (state.resolving ?? reopens.running)
      await state.explorer?.familiesPending() // a family on its way: a change not drawn yet
    },
    /** A frame, `ahead` stepping first: drawn now, or once the world can (`worldAskedFrame.ts`). */
    render: askedFrame({
      // The session opening, or the families the frame draws with on their way (`familyUse.ts`).
      waits: () =>
        state.explorer ? state.explorer.familiesPending() : (state.resolving ?? reopens.running),
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
      if (state.mirror) releaseWorldMirror(state.mirror.root)
      contents.cuts.dispose()
      scene.traverse((node) => (node._link = null))
    },
  }
}
