import { createFrameRevisions, bumpView, type FrameRevisions } from './revisions.ts'
import { trackViewCamera } from './viewCamera.ts'
import { createViewHold, type ViewHold } from './viewRevision.ts'
import { createHostSceneWatch } from '../host/scene/watch.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import { readCameraWorld, type HostCamera } from '../camera/world.ts'
import type { CameraMotion } from '../camera/motion.ts'
import { resolvePixelError } from '../page/selection/requests.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { readScene, type FrameGateSources, type HostWrite } from './gateScene.ts'

/** THE FRAME GATE'S STATE AND ITS VIEW STEPS (`gateCore.ts`): the revisions, the drawn view's hold
 *  and frame entry; what it reads of the source graph is `gateScene.ts`. */

/** What the gate's steps share: the revisions, the drawn view's hold, the watch over the source
 *  graph, and the revisions the gate last read. */
export type GateState = {
  holdValues: number
  revisions: FrameRevisions
  own: ViewHold
  sceneWatch: ReturnType<typeof createHostSceneWatch>
  worldsRevision: number
  watchRevision: number
  pixelError: number
  /** A host write no world pass has read yet: announced by the scan, or unread when the engine
   *  wrote. */
  hostPosesOwed: boolean
  /** The scene changed shape since the last world pass — the first image, a node destroyed, an
   *  engine edit that is not a pose —: the next one walks every root. A node the host reparented
   *  walks the roots under it alone (`takeWritten`, `takeFlipped`). */
  reshaped: boolean
  /** What the last world pass read, rewritten by the next. */
  write: HostWrite
}

/** The gate's state before its first frame. */
export function gateState(holdValues: number): GateState {
  const revisions = createFrameRevisions()
  return {
    holdValues,
    revisions,
    own: createViewHold(holdValues, revisions.view),
    sceneWatch: createHostSceneWatch(),
    worldsRevision: 0,
    watchRevision: -1,
    pixelError: 0,
    hostPosesOwed: false,
    reshaped: true,
    write: { reshaped: true, flipped: [] },
  }
}

/** Switches this view's hold and revision; scene/resources remain shared across all views. */
export function useViewHold(core: GateState, next: ViewHold | undefined) {
  const { revisions } = core
  const from = core.own
  from.view = revisions.view
  core.own = next ?? createViewHold(core.holdValues, revisions.view)
  revisions.view = core.own.view
  return from
}

/** This frame's view: the engine camera, the viewport when known, the quality threshold. */
export type ViewRead = [
  view: EngineCamera,
  viewport: readonly [number, number] | undefined,
  error: number,
]

/** Rereads this frame's view; returns true if any of its numbers moved. */
export function viewChanged(core: GateState, ...[view, viewport, error]: ViewRead) {
  return core.own.fingerprint.read(
    core.revisions,
    view,
    viewport ? viewport[0] : -1,
    viewport ? viewport[1] : -1,
    error,
  )
}

export const held = ({ own, revisions }: GateState) => own.hold.stable && own.hold.same(revisions)

/** What frame entry reads: the quality settings, the host camera and its motion, the viewport,
 *  the source graph and what to reread of it, and the aspect ratio the image is drawn at when a
 *  second view renders aside at its own. */
export type FrameEntry = [
  context: { pixelError?: number; lodAdaptive?: boolean },
  camera: HostCamera,
  motion: CameraMotion,
  viewport: readonly [number, number] | undefined,
  source: Object3D,
  drawn: FrameGateSources,
  aspect?: number,
]

/**
 * Frame entry, in the order every engine follows, and which carries the hold verdict.
 *
 * The camera world pose, ancestors included, is resolved and copied into the engine camera
 * first and once — view, view-projection, frustum planes, eye: the adaptive threshold reads
 * it, then the view fingerprint (contract and guarantees: `../camera/world.ts`). Camera speed is
 * read every frame, held or not: skipping it would skew the adaptive threshold of the first
 * frame that moves again. Finally the host may write the source graph without going through
 * the engine: the reread is what announces it, and it precedes the hold decision.
 */
export function enterFrame(core: GateState, cam: EngineCamera, ...entry: FrameEntry) {
  const [context, camera, motion, viewport, source, drawn, aspect] = entry
  readCameraWorld(cam, camera, aspect)
  if (trackViewCamera(core.own, camera, cam, viewport?.[0] ?? -1, viewport?.[1] ?? -1))
    bumpView(core.revisions)
  core.pixelError = resolvePixelError(context, cam, motion)
  viewChanged(core, cam, viewport, core.pixelError)
  readScene(core, source, drawn)
  return held(core)
}
