import { openMeasuredWorld, type MeasuredWorld } from '../explorer.ts'
import { buildWorldSource } from './source.ts'
import type { createRequestLoop } from './requestLoop.ts'
import type { createWorldContents } from './contents.ts'
import type { createWorldLights } from './lights.ts'
import type { createWorldVolumes } from './volumes.ts'
import type { createWorldBackground } from './background.ts'
import type { worldReopens } from './reopen.ts'
import type { followPageCamera } from './camera.ts'
import type { namedMove } from './sceneMethods.ts'
import type { WorldRuntimeInputs } from './runtimeInputs.ts'
import type { MeasuredWorldOptions } from '../options.ts'
import { DYNAMIC_UPLOAD_BUDGET_BYTES } from './dynamic/dynamic.ts'
import { vertexUploads } from './dynamic/dynamicRanges.ts'
import { noticeRefused } from '../../diagnostic/world/worldNotices.ts'

/** What a world runtime holds between frames: its session, the mirror it was opened on, and what
 *  the next frame or opening owes the scene. */
export type WorldRuntimeState = {
  explorer: MeasuredWorld | null
  seatWanted: boolean
  lightsChanged: boolean
  disposed: boolean
  /** Why no session is open: the first-frame watch says it on the console. */
  closed: string
}

/** What the steps of a world runtime share (`runtime.ts`). */
export type WorldRuntimeParts = {
  inputs: WorldRuntimeInputs
  state: WorldRuntimeState
  contents: ReturnType<typeof createWorldContents>
  lights: ReturnType<typeof createWorldLights>
  volumes: ReturnType<typeof createWorldVolumes>
  background: ReturnType<typeof createWorldBackground>
  track: ReturnType<typeof worldReopens>
  /** The page leads the frames: the world follows the canvas's size before each. */
  led: boolean
  placeCamera: ReturnType<typeof followPageCamera>
  moveNamed: ReturnType<typeof namedMove>
  /** The scene's resolutions, one pass at a time (`runtime.ts`). */
  resolves: ReturnType<typeof createRequestLoop>
  invalidate: () => void
}

/** The loop of openings a world runs (`requestLoop.ts`). */
export type WorldReopens = ReturnType<typeof createRequestLoop>

/** The models a world not yet drawing asked for are in its scene, and resolved, before the plan
 *  is taken (`loader.ts`); a refused grant of the device is said below. */
async function awaitResolved(parts: WorldRuntimeParts) {
  const { inputs, state } = parts
  await inputs.ready().catch(() => {})
  while (parts.resolves.running && !state.disposed) await parts.resolves.running
}

/** The session in place closed, and the plan the next one opens on taken from what the scene holds. */
function closeForPlan(parts: WorldRuntimeParts) {
  const { inputs, state, contents, lights, volumes, track } = parts
  state.closed = 'its session is opening'
  // What was resolved since the last frame opens with this session, not with the next one.
  if (state.seatWanted) contents.seat()
  state.seatWanted = false
  const plan = contents.plan()
  const built = buildWorldSource(plan)
  track.closing(state.explorer)
  state.explorer?.dispose()
  state.explorer = null
  plan.release()
  lights.reset()
  volumes.reset()
  state.lightsChanged = true
  inputs.diagnostic.opening()
  return built
}

/** The session opened on `built`, with the options it opens under; none, said, when it fails. */
async function openSession(
  parts: WorldRuntimeParts,
  built: NonNullable<ReturnType<typeof buildWorldSource>>,
) {
  const { inputs, state, placeCamera, moveNamed } = parts
  const { canvas, open = openMeasuredWorld } = inputs
  try {
    const scope = built.source.metadata.scope // its first model's scope, or the default
    await inputs.ready() // a lost device is asked again: it opens on what is granted, or fails
    const options: MeasuredWorldOptions = {
      ...inputs.options(),
      scope,
      onContentRefused: (what, reason) => noticeRefused(inputs.diagnostic.notices, what, reason),
      onPartitionOutgrown: () =>
        noticeRefused(
          inputs.diagnostic.notices,
          'partition rows',
          'the view outgrew the rows and the engine cannot grow them in place: the cells past them wait',
        ),
    }
    // The first frame is read for the page's camera, not a framing one (`prepare.ts`).
    const explorer = (state.explorer = await open(canvas, options, {
      ...built.source,
      placeCamera,
      moveNamed,
    }))
    return { explorer, options }
  } catch (error) {
    state.closed = 'its session failed to open'
    if (!state.disposed) inputs.diagnostic.failed(error) // cut short by disposal, it failed nothing
    return undefined
  }
}

/** One opening: the session in place closed, the next one opened on what the scene holds. */
export function worldOpening(parts: WorldRuntimeParts) {
  const { inputs, state, track } = parts
  return async () => {
    if (state.disposed) return
    // Awaited only without a session: one in place closes in this very call, before any frame.
    if (!state.explorer) {
      await awaitResolved(parts)
      if (state.disposed) return
    }
    const built = closeForPlan(parts)
    if (!built) {
      state.closed = 'nothing to draw: the scene holds no mesh and no loaded model'
      return track.none()
    }
    const opened = await openSession(parts, built)
    if (!opened) return track.none()
    const { explorer, options } = opened
    if (state.disposed) return explorer.dispose()
    // Lit before the page's own settings: the first image had no lights. A session's own loop is
    // asked a frame; a world its page leads draws the frame it asks (`frames/askedFrame.ts`).
    explorer.setLightingView('lit')
    // What the scene gained while it opened — a mesh, a model — joins at the next frame.
    state.seatWanted = true
    parts.invalidate()
    inputs.opened(explorer, options)
  }
}

/** The change list, applied once before a frame: rows seated, poses written, lights stored. */
export function worldApply(parts: WorldRuntimeParts, reopens: WorldReopens) {
  const { inputs, state, contents, lights, volumes, background } = parts
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
    if (state.lightsChanged) {
      session.setEnvironment({
        ...inputs.display(),
        irradiance: lights.sync(session),
      })
      // The sky module's parts, after the lights its sun and sky light are: the clouds, their shadow
      // maps and the sky light's capture follow them.
      session.applySky(inputs.modules.sky.resolved)
    }
    state.lightsChanged = false
    volumes.sync(session)
    background.write(session)
  }
}
