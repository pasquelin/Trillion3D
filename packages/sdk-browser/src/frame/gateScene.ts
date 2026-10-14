import { bumpScene } from './revisions.ts'
import type { WatchedSources } from '../host/scene/watch.ts'
import type { HostWorldPlacements } from '../host/world/placements.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import type { GateState } from './gateState.ts'

/** WHAT THE FRAME GATE READS OF THE SOURCE GRAPH (`gateCore.ts`): its watch rebuilt on a change of
 *  shape, a scene change or a move in place announced, the host's writes read once a revision. */

/** What frame entry rereads from the source graph, or what to reread it from when the list itself
 *  is rebuilt only on a scene change: the call then has nothing to build per frame. */
export type FrameGateSources = WatchedSources | (() => WatchedSources)

/** What the world pass a scene revision owes read of the host's writes (`updateWorlds`): whether
 *  every root is walked — the scene changed shape —, else the nodes shown, hidden or set to cast
 *  or not, whose roots alone follow; the nodes whose pose or matrix was written go to its
 *  `moved`. */
export type HostWrite = { reshaped: boolean; flipped: readonly Object3D[] }

/** Rebuilds the watched set; declared once, so a frame that reads the scene allocates nothing. */
const observe = (core: GateState, source: Object3D, drawn: FrameGateSources) =>
  core.sceneWatch.observe(source, typeof drawn === 'function' ? drawn() : drawn)

/** The scene moved: matrices, materials, instances, lights, diagnostic view. What the engine
 *  wrote into the source graph on the way is announced by this revision: the watch does not
 *  announce it a second time, and the next `readScene` reads the list anew under it. */
export function sceneChanged(core: GateState) {
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
export function movedInPlace(core: GateState) {
  // Only a watched set UP TO DATE with the current scene is carried over. Before the first
  // image it does not exist yet; after a reshape already announced it no longer names the
  // right nodes. Keeping either would drop the rebuild `readScene` still owes: the node the
  // reshape brought in would never be hooked, and every host write on it lost for good.
  const current = core.watchRevision === core.revisions.scene
  bumpScene(core.revisions)
  core.sceneWatch.settle()
  if (current) core.watchRevision = core.revisions.scene
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
export function readScene(core: GateState, source: Object3D, drawn: FrameGateSources) {
  const { revisions } = core
  if (core.watchRevision !== revisions.scene) observe(core, source, drawn)
  const verdict = core.sceneWatch.take()
  if (verdict) {
    bumpScene(revisions)
    core.hostPosesOwed = true
    // The list is rebuilt in this very frame: a node the reshape brought in is hooked before
    // the host can write it again, so no write falls between the reshape and the rebuild.
    if (verdict === 'reshaped') {
      // Only a node destroyed owes every root; one reparented names the roots under it.
      if (core.sceneWatch.takeDestroyed()) core.reshaped = true
      observe(core, source, drawn)
    }
  }
  core.watchRevision = revisions.scene
}

/** Once per scene revision no engine move already took, brings the world matrices up to date
 *  (the transform tree's pass, which walks only what was written since the last) and returns what
 *  the host wrote (`HostWrite`); `moved` first hears the nodes written — read off the scene watch,
 *  never a list the page shares —, unless every root is to be walked. A frame nothing announced
 *  runs no pass. */
export function updateWorlds(
  core: GateState,
  worlds: HostWorldPlacements,
  moved?: (nodes: ReadonlySet<Object3D>) => void,
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
export function engineWriting(core: GateState) {
  if (core.sceneWatch.pending()) core.hostPosesOwed = true
}

/** The rows already carry the current revision's matrices: written by the engine's own move,
 *  on the only roots it moved — unless a host write is owed. */
export function noteWorldsUpdated(core: GateState) {
  if (!core.hostPosesOwed && !core.reshaped) core.worldsRevision = core.revisions.scene
}
