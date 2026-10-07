import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { openMeasuredWorld, type MeasuredWorld } from '../session/explorer.ts'
import { buildWorldSource } from './worldSource.ts'
import type { createRequestLoop } from './requestLoop.ts'
import type { createWorldContents } from './worldContents.ts'
import { releaseWorldMirror } from './worldMirror.ts'
import type { createWorldLights } from './worldLights.ts'
import type { createWorldBackground } from './worldBackground.ts'
import type { worldReopens } from './worldReopen.ts'
import type { createCanvasFit, followPageCamera } from './worldCamera.ts'
import type { PosedTwin } from './worldPoses.ts'
import type { namedMove } from './worldSceneMethods.ts'
import type { WorldRuntimeInputs } from './worldRuntimeInputs.ts'
import { DYNAMIC_UPLOAD_BUDGET_BYTES } from './worldDynamic.ts'
import { vertexUploads } from './worldDynamicRanges.ts'

/** What a world runtime holds between frames: its session, the mirror it was opened on, and what
 *  the next frame or opening owes the scene. */
export type WorldRuntimeState = {
  explorer: MeasuredWorld | null
  mirror: NonNullable<ReturnType<typeof buildWorldSource>> | null
  twins: Map<Object3D, PosedTwin>
  resolving: Promise<void> | null
  structureChanged: boolean
  seatWanted: boolean
  lightsChanged: boolean
  disposed: boolean
  /** Why no session is open: the first-frame watch says it on the console. */
  closed: string
}

/** What the steps of a world runtime share (`worldRuntime.ts`). */
export type WorldRuntimeParts = {
  inputs: WorldRuntimeInputs
  state: WorldRuntimeState
  contents: ReturnType<typeof createWorldContents>
  lights: ReturnType<typeof createWorldLights>
  background: ReturnType<typeof createWorldBackground>
  track: ReturnType<typeof worldReopens>
  fit: ReturnType<typeof createCanvasFit>
  placeCamera: ReturnType<typeof followPageCamera>
  moveNamed: ReturnType<typeof namedMove>
  invalidate: () => void
}

/** The loop of openings a world runs (`requestLoop.ts`). */
export type WorldReopens = ReturnType<typeof createRequestLoop>

/** One opening: the session in place closed, the next one opened on what the scene holds. */
export function worldOpening(parts: WorldRuntimeParts) {
  const { inputs, state, contents, lights, track, fit, placeCamera, moveNamed } = parts
  const { canvas, open = openMeasuredWorld } = inputs
  return async () => {
    if (state.disposed) return
    state.closed = 'its session is opening'
    // What was resolved since the last frame opens with this session, not with the next one.
    if (state.seatWanted) contents.seat()
    state.seatWanted = false
    const plan = contents.plan()
    const built = buildWorldSource(plan)
    track.closing(state.explorer)
    state.explorer?.dispose()
    if (state.mirror) releaseWorldMirror(state.mirror.root)
    state.explorer = state.mirror = null
    fit.reset()
    plan.release()
    state.twins = (built?.twins ?? new Map()) as Map<Object3D, PosedTwin>
    for (const [node, twin] of state.twins)
      contents.poses.writeTwin(node, twin, contents.shown(node))
    lights.reset()
    state.lightsChanged = true
    inputs.diagnostic.opening()
    if (!built) {
      state.closed = 'nothing to draw: the scene holds no mesh and no loaded model'
      return track.none()
    }
    state.mirror = built
    let explorer: MeasuredWorld
    try {
      const scope = built.source.metadata.scope // its first model's scope, or the default
      await inputs.ready() // a lost device is asked again: it opens on what is granted, or fails
      const given = inputs.options()
      // The session's own loop hands its frames on as `render()` does: bytes told (#573).
      const onFrame: typeof given.onFrame = (m) => (
        contents.cuts.dynamic.drew(m),
        given.onFrame?.(m)
      )
      const options = track.options({ ...given, scope, onFrame })
      // The first frame is read for the page's camera, not a framing one (`prepare.ts`).
      explorer = state.explorer = await open(canvas, options, {
        ...built.source,
        placeCamera,
        moveNamed,
      })
    } catch (error) {
      state.closed = 'its session failed to open'
      if (!state.disposed) inputs.diagnostic.failed(error) // cut short by disposal, it failed nothing
      return track.none()
    }
    if (state.disposed) return explorer.dispose()
    // Lit before the page's own settings: the first image had no lights. A session's own loop is
    // asked a frame; a world its page leads draws the frame it asks (`worldAskedFrame.ts`).
    explorer.setLightingView('lit')
    parts.invalidate()
    inputs.opened(explorer)
  }
}

/** The change list, applied once before a frame: rows seated, poses written, lights stored. */
export function worldApply(parts: WorldRuntimeParts, reopens: WorldReopens) {
  const { inputs, state, contents, lights, background, track } = parts
  const { poses, cuts } = contents
  const uploads = vertexUploads(
    () => state.explorer,
    (cut) => state.mirror?.geometryOf(cut),
    track.asks('vertices-refused'),
  )
  return () => {
    const session = state.explorer
    if (state.seatWanted) {
      state.seatWanted = false
      contents.seat(session ?? undefined)
      if (contents.reopenNeeded() || (!session && !reopens.running)) track.request('scene-change')
      // Values or pictures alone repaint the built surface (#335, #362, #572); a reopened one is new.
      const painted = contents.repainted(),
        open = state.explorer === session ? session : null
      const mirror = state.mirror
      if (painted.length && mirror && !mirror.repaint(painted, open?.refreshMaterials.bind(open)))
        track.request('repaint-refused')
    }
    if (!session || state.explorer !== session) return
    cuts.dynamic.upload(DYNAMIC_UPLOAD_BUDGET_BYTES, uploads)
    if (poses.pending)
      poses.apply(
        inputs.scene,
        contents.seats,
        state.twins,
        (rows, from, to) => session.updatePlacements(rows, from, to),
        {
          key: session,
          epoch: contents.seatEpoch,
          link: (parent, world, links, whole) =>
            session.composePlacements(parent, world, links, whole),
        },
      )
    if (state.lightsChanged)
      session.setEnvironment({ ...inputs.display(), irradiance: lights.sync(session) })
    state.lightsChanged = false
    background.write(session)
  }
}
