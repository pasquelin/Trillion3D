import {
  bumpResources,
  bumpScene,
  bumpView,
  createFrameRevisions,
  type FrameRevisions,
} from './revisions.ts'
import { trackViewCamera } from './viewCamera.ts'
import { createViewHold, type ViewHold } from './viewRevision.ts'
import { createHostSceneWatch, type WatchedSources } from '../host/scene/watch.ts'
import {
  createEngineCamera,
  readCameraWorld,
  type CameraMotion,
  type EngineCamera,
  type HostCamera,
} from '../camera/world.ts'
import { resolvePixelError } from '../page/selection/selection.ts'
import type { HostWorldPlacements } from '../host/world/placements.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'

export type FrameGateCore = ReturnType<typeof createFrameGateCore>

/** What frame entry rereads from the source graph, or what to reread it from when the list itself
 *  is rebuilt only on a scene change: the call then has nothing to build per frame. */
type FrameGateSources = WatchedSources | (() => WatchedSources)

/** What the gate's steps share: the revisions, the drawn view's hold, the watch over the source
 *  graph, and the revisions the gate last read. */
type GateState = {
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
  /** The scene changed shape since the last world pass — the first image, a node added or
   *  reparented, an engine edit that is not a pose —: the next one walks every root. */
  reshaped: boolean
  /** What the last world pass read, rewritten by the next. */
  write: HostWrite
}

/** What the world pass a scene revision owes read of the host's writes (`updateWorlds`): whether
 *  every root is walked — the scene changed shape —, else the nodes shown, hidden or set to cast
 *  or not, whose roots alone follow; the nodes whose pose or matrix was written go to its
 *  `moved`. */
type HostWrite = { reshaped: boolean; flipped: readonly Object3D[] }

/**
 * The engine's frame gate: the three revisions, the view origin, the reread of the graph
 * the host may write, and the held-frame witness. `holdValues` is how many values a frame signature
 * of this engine carries.
 */
export function createFrameGateCore(holdValues: number) {
  const core = gateState(holdValues)
  const { revisions } = core
  const gate = {
    revisions,
    /** Discontinuities belong to this view; continuous motion preserves image history. */
    get temporalRevision() {
      return core.own.temporalRevision
    },
    /** The drawn view's held-frame witness: each view keeps its own (`useViewHold`). */
    get hold() {
      return core.own.hold
    },
    useViewHold: (next: ViewHold | undefined) => useViewHold(core, next),
    /** Copied engine camera of the drawn view (`../webgpu/pages/state/viewSwitch.ts`). Frame
     *  entry copies the host's into it, once, and everything downstream reads it. Allocated here,
     *  never per frame. */
    cam: createEngineCamera(),
    /** Quality threshold `enterFrame` has just resolved for the current frame. */
    get pixelError() {
      return core.pixelError
    },
    sceneChanged: () => sceneChanged(core),
    /** The scene moved and its shape did not: a pose the engine wrote, a light, the environment,
     *  the lighting view or a material of its own store (`movedInPlace`). */
    movedInPlace: () => movedInPlace(core),
    resourcesChanged: () => bumpResources(revisions),
    /** The drawn view's target will no longer carry its held frame: its own hold alone breaks. */
    viewReplaced: () => bumpView(revisions),
    viewChanged: (...view: ViewRead) => viewChanged(core, ...view),
    /** The drawn view's view, projection, near plane or viewport moved since the last drawn image
     *  took it: every row the occluder history kept may leave the occluders again. */
    takeViewMoved: () => core.own.fingerprint.takeMoved(),
    readScene: (source: Object3D, drawn: FrameGateSources) => readScene(core, source, drawn),
    /** True when two identical frames followed each other and nothing has moved since. */
    held: () => held(core),
    updateWorlds: (worlds: HostWorldPlacements, moved?: (nodes: Iterable<Object3D>) => void) =>
      updateWorlds(core, worlds, moved),
    /** The nodes the host wrote, its poses or its matrices, which no world pass read yet: an
     *  engine move takes them with its own, its pass refreshing them (`movedBatch.ts`). */
    takeHostMoves: () => core.sceneWatch.takeWritten(),
    /** The engine posed `node` itself: the scene watch takes its pose as the engine's, never as a
     *  host write read back. */
    adoptPose: (node: Object3D) => core.sceneWatch.adopt(node),
    noteWorldsUpdated: () => noteWorldsUpdated(core),
    /** The engine moved poses in place: `movedInPlace` and `noteWorldsUpdated`, `engineWriting`
     *  first so an unread host pose write stays owed. */
    engineMovedInPlace() {
      engineWriting(core)
      movedInPlace(core)
      noteWorldsUpdated(core)
    },
    /** Lets go of the source graph: its writes no longer reach this gate. */
    release: () => core.sceneWatch.release(),
    enterFrame: (...frame: FrameEntry) => enterFrame(core, gate.cam, ...frame),
  }
  return gate
}

/** The gate's state before its first frame. */
function gateState(holdValues: number): GateState {
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
function useViewHold(core: GateState, next: ViewHold | undefined) {
  const { revisions } = core
  const from = core.own
  from.view = revisions.view
  core.own = next ?? createViewHold(core.holdValues, revisions.view)
  revisions.view = core.own.view
  return from
}

/** Rebuilds the watched set; declared once, so a frame that reads the scene allocates nothing. */
const observe = (core: GateState, source: Object3D, drawn: FrameGateSources) =>
  core.sceneWatch.observe(source, typeof drawn === 'function' ? drawn() : drawn)

/** The scene moved: matrices, materials, instances, lights, diagnostic view. What the engine
 *  wrote into the source graph on the way is announced by this revision: the watch does not
 *  announce it a second time, and the next `readScene` reads the list anew under it. */
function sceneChanged(core: GateState) {
  bumpScene(core.revisions)
  core.sceneWatch.settle()
  core.reshaped = true
}

/**
 * The scene moved and its shape did not: the engine wrote the local pose of a node already drawn,
 * or a light, the environment, the lighting view of its own store. The watched set therefore has
 * exactly the same members, and this revision does not ask for it to be read anew — which is a
 * full walk of the source graph, and would be paid on every image while a node moves or a sun
 * turns —, nor every root walked.
 */
function movedInPlace(core: GateState) {
  // Only a watched set UP TO DATE with the current scene is carried over. Before the first
  // image it does not exist yet; after a reshape already announced it no longer names the
  // right nodes. Keeping either would drop the rebuild `readScene` still owes: the node the
  // reshape brought in would never be hooked, and every host write on it lost for good.
  const current = core.watchRevision === core.revisions.scene
  bumpScene(core.revisions)
  core.sceneWatch.settle()
  if (current) core.watchRevision = core.revisions.scene
}

/** This frame's view: the engine camera, the viewport when known, the quality threshold. */
type ViewRead = [view: EngineCamera, viewport: readonly [number, number] | undefined, error: number]

/** Rereads this frame's view; returns true if any of its numbers moved. */
function viewChanged(core: GateState, ...[view, viewport, error]: ViewRead) {
  return core.own.fingerprint.read(
    core.revisions,
    view,
    viewport ? viewport[0] : -1,
    viewport ? viewport[1] : -1,
    error,
  )
}

/**
 * Declares the scene changed when the host wrote the source nodes directly — a pose, a
 * visibility, a light — without going through the engine. Call BEFORE `held()`: without
 * that the frame would be held on a stale scene. Nothing is walked up here: a pose write
 * incremented the watch's revision itself, and the other fields are read only once the
 * engine's write count moved — a still frame compares two pairs of integers.
 *
 * The watched node list is rebuilt after a scene change that may have reshaped it — one more
 * instance, a light set after the fact, a node reparented or a light retargeted by the host
 * — never per frame, and never after a pose write, which changes no node's membership.
 */
function readScene(core: GateState, source: Object3D, drawn: FrameGateSources) {
  const { revisions } = core
  if (core.watchRevision !== revisions.scene) observe(core, source, drawn)
  const verdict = core.sceneWatch.take()
  if (verdict) {
    bumpScene(revisions)
    core.hostPosesOwed = true
    // The list is rebuilt in this very frame: a node the reshape brought in is hooked before
    // the host can write it again, so no write falls between the reshape and the rebuild.
    if (verdict === 'reshaped') {
      core.reshaped = true
      observe(core, source, drawn)
    }
  }
  core.watchRevision = revisions.scene
}

const held = ({ own, revisions }: GateState) => own.hold.stable && own.hold.same(revisions)

/** Once per scene revision no engine move already took, brings the world matrices up to date
 *  (the transform tree's pass, which walks only what was written since the last) and returns what
 *  the host wrote (`HostWrite`); `moved` first hears the nodes written — read off the scene watch,
 *  never a list the page shares —, unless every root is to be walked. A frame nothing announced
 *  runs no pass. */
function updateWorlds(
  core: GateState,
  worlds: HostWorldPlacements,
  moved?: (nodes: Iterable<Object3D>) => void,
) {
  if (core.worldsRevision === core.revisions.scene) return false
  core.worldsRevision = core.revisions.scene
  core.hostPosesOwed = false
  const write = core.write
  write.reshaped = core.reshaped
  write.flipped = core.sceneWatch.takeFlipped()
  const nodes = core.sceneWatch.takeWritten()
  core.reshaped = false
  if (!write.reshaped) moved?.(nodes)
  worlds.refresh()
  return write
}

/**
 * To call before the engine moves poses in place of its own (`engineMovedInPlace`), and before it
 * announces the move: the move settles the watch, and a host pose write still unread in the same
 * task, kept by the watch (`takeWritten`), would be read by no world pass — its roots' rows would
 * keep the old world. Such a write is kept owed instead: `noteWorldsUpdated` no longer spares the
 * next image its world pass, which names it. One comparison of two integers when the host wrote
 * nothing, which is every image a model moves.
 */
function engineWriting(core: GateState) {
  if (core.sceneWatch.pending()) core.hostPosesOwed = true
}

/** The rows already carry the current revision's matrices: written by the engine's own move,
 *  on the only roots it moved — unless a host write is owed. */
function noteWorldsUpdated(core: GateState) {
  if (!core.hostPosesOwed && !core.reshaped) core.worldsRevision = core.revisions.scene
}

/** What frame entry reads: the quality settings, the host camera and its motion, the viewport,
 *  the source graph and what to reread of it, and the aspect ratio the image is drawn at when a
 *  second view renders aside at its own. */
type FrameEntry = [
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
function enterFrame(core: GateState, cam: EngineCamera, ...entry: FrameEntry) {
  const [context, camera, motion, viewport, source, drawn, aspect] = entry
  readCameraWorld(cam, camera, aspect)
  if (trackViewCamera(core.own, camera, cam, viewport?.[0] ?? -1, viewport?.[1] ?? -1))
    bumpView(core.revisions)
  core.pixelError = resolvePixelError(context, cam, motion)
  viewChanged(core, cam, viewport, core.pixelError)
  readScene(core, source, drawn)
  return held(core)
}
