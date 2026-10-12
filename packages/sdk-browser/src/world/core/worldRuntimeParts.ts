import { openMeasuredWorld, type MeasuredWorld } from '../session/explorer.ts'
import { buildWorldSource } from './worldSource.ts'
import type { createRequestLoop } from './requestLoop.ts'
import type { createWorldContents } from './worldContents.ts'
import type { createWorldLights } from './worldLights.ts'
import type { createWorldBackground } from './worldBackground.ts'
import type { worldReopens } from './worldReopen.ts'
import type { createCanvasFit, followPageCamera } from './worldCamera.ts'
import type { namedMove } from './worldSceneMethods.ts'
import type { WorldRuntimeInputs } from './worldRuntimeInputs.ts'
import { DYNAMIC_UPLOAD_BUDGET_BYTES } from './worldDynamic.ts'
import { vertexUploads } from './worldDynamicRanges.ts'
import { noticeRefused } from '../diagnostic/worldNotices.ts'

/** What a world runtime holds between frames: its session, the mirror it was opened on, and what
 *  the next frame or opening owes the scene. */
export type WorldRuntimeState = {
  explorer: MeasuredWorld | null
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
    // The models a world not yet drawing asked for are in its scene, and resolved, before the plan
    // is taken (`worldLoader.ts`); a refused grant of the device is said below. A session in
    // place, closed for a lost device or an option, is closed at once.
    if (!state.explorer) {
      await inputs.ready().catch(() => {})
      while (state.resolving && !state.disposed) await state.resolving
      if (state.disposed) return
    }
    state.closed = 'its session is opening'
    // What was resolved since the last frame opens with this session, not with the next one.
    if (state.seatWanted) contents.seat()
    state.seatWanted = false
    const plan = contents.plan()
    const built = buildWorldSource(plan)
    track.closing(state.explorer)
    state.explorer?.dispose()
    state.explorer = null
    fit.reset()
    plan.release()
    lights.reset()
    state.lightsChanged = true
    inputs.diagnostic.opening()
    if (!built) {
      state.closed = 'nothing to draw: the scene holds no mesh and no loaded model'
      return track.none()
    }
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
      const options = track.options({
        ...{ ...given, scope, onFrame },
        onPartitionOutgrown: () =>
          noticeRefused(
            inputs.diagnostic.notices,
            'partition rows',
            'the view outgrew the rows and the engine cannot grow them in place: the cells past them wait',
          ),
      })
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
    // What the scene gained while it opened — a mesh, a model — joins at the next frame.
    state.seatWanted = true
    parts.invalidate()
    inputs.opened(explorer)
  }
}

/** The change list, applied once before a frame: rows seated, poses written, lights stored. */
export function worldApply(parts: WorldRuntimeParts, reopens: WorldReopens) {
  const { inputs, state, contents, lights, background } = parts
  const { poses, cuts } = contents
  const uploads = vertexUploads(
    () => state.explorer,
    () =>
      noticeRefused(
        inputs.diagnostic.notices,
        'rewritten vertices',
        'the engine cannot write them in place: they are not drawn',
      ),
  )
  return () => {
    const session = state.explorer
    if (state.seatWanted) {
      state.seatWanted = false
      contents.seat(session ?? undefined)
      // No session: this opens the first (or the one a failed opening left), never reopens one.
      if (!session && !reopens.running) reopens.request()
      // Values or pictures alone repaint the built surface (#335, #362, #572); a session opened
      // meanwhile is new.
      const painted = contents.repainted(),
        open = state.explorer === session ? session : null
      if (painted.length && !contents.repaint(painted, open?.refreshMaterials.bind(open)))
        noticeRefused(
          inputs.diagnostic.notices,
          'a picture',
          'it changed size where the atlas layout is fixed: it is not redrawn',
        )
    }
    if (!session || state.explorer !== session) return
    cuts.dynamic.upload(DYNAMIC_UPLOAD_BUDGET_BYTES, uploads)
    if (poses.pending)
      poses.apply(
        inputs.scene,
        contents.seats,
        contents.models,
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
