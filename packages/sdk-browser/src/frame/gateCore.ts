import { bumpResources, bumpView } from './revisions.ts'
import type { ViewHold } from './viewRevision.ts'
import { createEngineCamera } from '../camera/engineCamera.ts'
import type { HostWorldPlacements } from '../host/world/placements.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import {
  enterFrame,
  gateState,
  held,
  useViewHold,
  viewChanged,
  type FrameEntry,
  type ViewRead,
} from './gateState.ts'
import {
  engineWriting,
  movedInPlace,
  noteWorldsUpdated,
  readScene,
  sceneChanged,
  updateWorlds,
  type FrameGateSources,
} from './gateScene.ts'

export type FrameGateCore = ReturnType<typeof createFrameGateCore>

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
    updateWorlds: (worlds: HostWorldPlacements, moved?: (nodes: ReadonlySet<Object3D>) => void) =>
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
