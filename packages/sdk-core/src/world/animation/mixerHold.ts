// A far rig that keeps its pose: while the view of its scene draws every point of the pose last
// written within half a pixel of the true pose (`poseHold.ts`), a mixer's frame only advances its
// actions' times — nothing sampled, blended or written, so no world matrix nor skinning palette
// downstream moves. Decided again each frame from the current view; any change of the actions'
// state, of the rig's parent or of the scene's structure writes the true pose.
import type { Object3D } from '../object/object3d.ts'
import { clipTimeOf, type Clip } from './clip.ts'
import type { Action, Mixer } from './mixer.ts'
import { rigReach, type RigReach } from './rigLevers.ts'
import { BLEND_SIN, holdTables, intervalOf, type HoldTable } from './poseHold.ts'
import { screenErrorBound } from '../../lod/screenErrorBound.ts'
import { objectEdits } from '../../scene/core/nodeEdits.ts'
import { dotScalar3, dotVector3Xyz } from '../../../../math/src/vector/vector.ts'

/** The most a held point may stray from where the true pose draws it, in pixels: under one
 *  pixel's half, it lands on the same pixel centre or the next. */
const MOST_PIXELS = 0.5

/** The camera a scene is drawn through: its eye and unit forward axis in world space, its focal
 *  length in pixels (`focalPixels`, the larger axis), near plane and clip-w weight (1
 *  perspective, 0 orthographic, `screenErrorBound`). */
type HoldView = {
  readonly eye: ArrayLike<number>
  readonly forward: ArrayLike<number>
  readonly focal: number
  readonly near: number
  readonly perspective: number
}

const views = new WeakMap<Object3D, () => HoldView | null>()
/** The view `scene` is drawn in, read by its mixers each frame (`null`: none, every frame
 *  written): what a world registers for its scene. */
export function viewScene(scene: Object3D, view: (() => HoldView | null) | null) {
  if (view) views.set(scene, view)
  else views.delete(scene)
}

/** While `advanceMixers` walks a frame, each scene's view read once (`holdWalk`). */
let walking = false
const seen = new Map<Object3D, HoldView | null>()
/** Starts or ends a frame's walk of the mixers: inside, a scene's view is read once. */
export function holdWalk(on: boolean) {
  walking = on
  seen.clear()
}

/** The view registered for the scene `root` hangs under. */
function viewOf(root: Object3D) {
  let top = root
  while (top.parent) top = top.parent
  let view = walking ? seen.get(top) : undefined
  if (view === undefined) {
    view = views.get(top)?.() ?? null
    if (walking) seen.set(top, view)
  }
  return view
}

/** Where each action's pose stands in its table (`HoldTable`): its lap (`lapOf`), the integrals at
 *  its clip time, and the interval it was found in, where the next read starts. */
type Placement = {
  lap: number[]
  moved: number[]
  turned: number[]
  leaps: number[]
  hint: number[]
}
const placement = (): Placement => ({ lap: [], moved: [], turned: [], leaps: [], hint: [] })

/** One playing action as the last update left it. */
type Played = {
  action: Action
  weight: number
  scale: number
  loop: Action['loop']
  mode: Action['blendMode']
  time: number
}

/** A mixer's state at its last update: its playing actions as they were — weight, speed, loop,
 *  blend, time —, its root's parent, the scene's edit count; the tables of its clips, where the
 *  pose last written stands in them (`at`, read when `placed`) and where the true pose of this
 *  frame stands (`next`, read when `ready`); `steady` while this frame changed none of it. */
type Hold = {
  count: number
  /** The playing actions as they were, the first `count` of them (entries are reused). */
  played: Played[]
  parent: Object3D | null
  edits: number
  clips: Clip[]
  reach: RigReach | null
  /** The rig `reach` was read from, to tell a scene edit that touched it from one that did not. */
  rig: Rig | null
  /** The tables of its clips once read (`holdTables`: `null` when an action is additive). */
  tables: HoldTable[] | null | undefined
  at: Placement
  placed: boolean
  next: Placement
  ready: boolean
  steady: boolean
  /** Frames held since the pose was written; frames left to write without asking (`WAITS`). */
  held: number
  wait: number
  /** The drift read for the next frame ahead of a held one, `aheadTo` seconds on from `at`
   *  (`NaN`: none): the next frame asks the same of the same state. */
  aheadTo: number
  ahead: Drift
}
const holds = new WeakMap<Mixer, Hold>()

/** `holdFrame`'s answers: write the true pose and ask the next frame's samples ahead, write it
 *  without asking (the next frame holds), hold, or write it and record nothing (no view, or a
 *  rig the view keeps far from holding, `WAITS`). */
export const WRITE = 0,
  WRITE_QUIET = 1,
  HELD = 2,
  UNRECORDED = 3
/** How many frames a rig whose pose strays `p` pixels a frame is written without being asked
 *  whether it holds: `2 log₂(p / MOST_PIXELS)`, at most `WAITS`. Writing is always the true pose;
 *  a view that brings the rig closer to holding is only found that much later. */
const WAITS = 30

/**
 * This frame of `mixer`, `seconds` long: `HELD` when its actions' state is the last update's and
 * the pose last written stays within `MOST_PIXELS` of the true pose at the current view — each
 * playing action then advanced by `seconds`, as `advance` would, and nothing else done; a held
 * frame asks ahead (`ask`) when the next one, `ahead` seconds on, will not hold. Else `WRITE`, or
 * `WRITE_QUIET` when the next frame will hold and needs no sample asked, or `UNRECORDED`.
 */
export function holdFrame(
  mixer: Mixer,
  actions: ReadonlyMap<Clip, Action>,
  seconds: number,
  ahead: number | null,
  ask: (action: Action) => void,
) {
  const hold = holds.get(mixer)
  if (hold && hold.wait > 0) {
    hold.wait--
    return UNRECORDED
  }
  const root = mixer.root,
    view = viewOf(root)
  if (!view) return UNRECORDED
  if (!hold) return WRITE
  hold.steady = hold.ready = false
  if (!unchanged(hold, actions, root)) return WRITE
  if (hold.tables === undefined) hold.tables = tablesOf(hold, root)
  const tables = hold.tables
  if (!tables || !(hold.count > 0)) return WRITE
  if (!hold.placed) placeWritten(hold, tables)
  hold.steady = true
  let pixels = FAR
  // The drift the last held frame read for this one, when the view alone has changed.
  if (hold.aheadTo === seconds) {
    copyDrift(hold.ahead, drift)
    pixels = pixelsOfDrift(hold, root, view)
  }
  if (!(pixels < MOST_PIXELS)) pixels = lag(hold, tables, root, view, hold.at, seconds, hold.next)
  hold.ready = pixels !== FAR
  if (pixels < MOST_PIXELS) {
    hold.steady = hold.ready = false
    for (let i = 0; i < hold.count; i++) {
      const played = hold.played[i]
      played.time = played.action.time += seconds * played.action.timeScale
    }
    hold.held++
    if (ahead !== null) {
      const pixels = lag(hold, tables, root, view, hold.at, ahead, null)
      copyDrift(drift, hold.ahead)
      hold.aheadTo = ahead
      if (!(pixels < MOST_PIXELS)) for (let i = 0; i < hold.count; i++) ask(hold.played[i].action)
    }
    return HELD
  }
  // A lap's end or a leap says nothing of the view: only a bound found too large does.
  const perFrame = pixels / (hold.held + 1)
  if (perFrame > MOST_PIXELS && pixels < Number.MAX_VALUE)
    hold.wait = Math.min(WAITS, Math.floor(2 * Math.log2(perFrame / MOST_PIXELS)))
  if (ahead === null || !hold.ready) return WRITE
  return lag(hold, tables, root, view, hold.next, seconds + ahead, null) < MOST_PIXELS
    ? WRITE_QUIET
    : WRITE
}

/** Records `mixer`'s state after an update that wrote its pose. */
export function holdWritten(mixer: Mixer, actions: ReadonlyMap<Clip, Action>) {
  let hold = holds.get(mixer)
  if (!hold) holds.set(mixer, (hold = empty()))
  // A steady frame's actions are the ones recorded, each advanced to where `next` read it.
  let still = hold.steady
  for (let i = 0; still && i < hold.count; i++) still = hold.played[i].action.playingNow
  if (still) {
    for (let i = 0; i < hold.count; i++) hold.played[i].time = hold.played[i].action.time
    ;[hold.at, hold.next] = [hold.next, hold.at]
    hold.placed = hold.ready
    hold.steady = hold.ready = false
    hold.held = 0
    hold.aheadTo = NaN
    return
  }
  let count = 0,
    same = true
  for (const action of actions.values()) {
    if (!action.playingNow) continue
    const i = count++
    const was = hold.played[i]
    same &&= was?.action === action && was.weight === action.weight && was.mode === action.blendMode
    const now = (hold.played[i] ??= {
      action,
      weight: 0,
      scale: 0,
      loop: action.loop,
      mode: action.blendMode,
      time: 0,
    })
    now.action = action
    now.weight = action.weight
    now.scale = action.timeScale
    now.loop = action.loop
    now.mode = action.blendMode
    now.time = action.time
  }
  const parent = mixer.root.parent
  if (parent !== hold.parent || !editsLeaveRig(hold, mixer.root)) hold.reach = null
  if (!same || count !== hold.count || !hold.reach) hold.tables = undefined
  hold.count = count
  hold.parent = parent
  hold.edits = objectEdits()
  hold.placed = hold.steady = hold.ready = false
  hold.held = 0
  hold.aheadTo = NaN
}

function empty(): Hold {
  return {
    count: -1,
    played: [],
    parent: null,
    edits: -1,
    clips: [],
    reach: null,
    rig: null,
    tables: undefined,
    at: placement(),
    placed: false,
    next: placement(),
    ready: false,
    steady: false,
    held: 0,
    wait: 0,
    aheadTo: NaN,
    ahead: { moved: 0, turned: 0, leaped: false, far: false },
  }
}

/** Whether `actions` play as at the last update, and the rig stands where it did. */
function unchanged(hold: Hold, actions: ReadonlyMap<Clip, Action>, root: Object3D) {
  let n = 0
  for (const a of actions.values()) {
    if (!a.playingNow) continue
    const was = hold.played[n]
    if (
      n >= hold.count ||
      was.action !== a ||
      a.weight !== was.weight ||
      a.timeScale !== was.scale ||
      a.loop !== was.loop ||
      a.blendMode !== was.mode ||
      a.time !== was.time
    )
      return false
    n++
  }
  return n === hold.count && root.parent === hold.parent && editsLeaveRig(hold, root)
}

/** The nodes under a root, in traversal order, with their names and parents: what a rig's reach
 *  is read from (`rigReach` walks names and children, `reachSkin` the vertices of its meshes). */
type Rig = { nodes: Object3D[]; names: string[]; parents: (Object3D | null)[] }

function rigOf(root: Object3D): Rig {
  const rig: Rig = { nodes: [], names: [], parents: [] }
  root.traverse((node) => {
    rig.nodes.push(node)
    rig.names.push(node.name)
    rig.parents.push(node.parent)
  })
  return rig
}

/** Whether the rig under `root` is the one `rig` records. */
function rigStands(root: Object3D, rig: Rig) {
  let i = 0
  let same = true
  root.traverse((node) => {
    same &&=
      i < rig.nodes.length &&
      rig.nodes[i] === node &&
      rig.names[i] === node.name &&
      rig.parents[i] === node.parent
    i++
  })
  return same && i === rig.nodes.length
}

/** Whether the scene edits since `hold` was recorded (`objectEdits`) left the rig under `root`
 *  as its reach read it: a name or a parent changed elsewhere says nothing of this rig. */
function editsLeaveRig(hold: Hold, root: Object3D) {
  const edits = objectEdits()
  if (edits === hold.edits) return true
  if (!hold.rig || !rigStands(root, hold.rig)) return false
  hold.edits = edits
  return true
}

/** The tables of the actions `hold` records, the rig's reach kept while its clips are the same. */
function tablesOf(hold: Hold, root: Object3D) {
  const clips = hold.played.slice(0, hold.count).map((p) => p.action.clip)
  if (clips.length !== hold.clips.length || clips.some((c, i) => c !== hold.clips[i]))
    hold.reach = null
  hold.clips = clips
  if (!hold.reach) {
    hold.reach = rigReach(root, clips)
    hold.rig = rigOf(root)
  }
  return holdTables(
    root,
    hold.reach,
    clips.map((clip, i) => ({
      clip,
      weight: hold.played[i].weight,
      additive: hold.played[i].mode === 'additive',
    })),
  )
}

/** Where `action`, `time` seconds in, stands: its lap (`floor(time / d)`, each lap played one way)
 *  and its clip time, the one the live pose reads (`clipTimeOf`). */
function lapOf(action: Action, time: number) {
  place.lap = Math.floor(time / (action.clip.duration || 1))
  place.at = clipTimeOf(action.clip, action.loop, time)
}
const place = { lap: 0, at: 0 }

/** Reads `table` at clip time `t` into `into`'s entry `i`, from the interval it last stood in. */
function readAt(table: HoldTable, t: number, into: Placement, i: number) {
  const { times } = table,
    last = times.length - 1
  let j = into.hint[i] ?? 0
  if (!(j <= last && times[j] <= t && (j === last || t < times[j + 1]))) {
    j++
    if (!(j < last && times[j] <= t && t < times[j + 1])) j = intervalOf(times, t)
  }
  const dt = Math.min(t, times[last]) - times[j]
  into.hint[i] = j
  into.moved[i] = dt > 0 ? table.moved[j] + table.rate[j] * dt : table.moved[j]
  into.turned[i] = dt > 0 ? table.turned[j] + table.turn[j] * dt : table.turned[j]
  into.leaps[i] = table.leaps[j]
}

/** Reads where the pose last written stands in `tables`. */
function placeWritten(hold: Hold, tables: HoldTable[]) {
  for (let i = 0; i < hold.count; i++) {
    lapOf(hold.played[i].action, hold.played[i].time)
    hold.at.lap[i] = place.lap
    readAt(tables[i], place.at, hold.at, i)
  }
  hold.placed = true
}

/** `lag` when an action leaves its lap: no bound, and `into` left unread. */
const FAR = Infinity
const scratch = placement()

/** What `lag` reads of the drift between two clip times, before any view: the most a point of the
 *  rig moved, its blended rotation's `x` grown, whether a value leaps, whether an action left the
 *  lap of the pose kept. */
type Drift = { moved: number; turned: number; leaped: boolean; far: boolean }
const drift: Drift = { moved: 0, turned: 0, leaped: false, far: false }

/**
 * The most pixels a point of the rig is drawn from its true pose at `view` when the pose standing
 * at `from` is kept until each action's time `to` seconds on — read into `into` when given:
 * `FAR` when an action leaves the lap of `from`, `Infinity` when a value leaps between them or a
 * blended rotation leaves its linear bound. The drift it read stays in `drift`.
 */
function lag(
  hold: Hold,
  tables: HoldTable[],
  root: Object3D,
  view: HoldView,
  from: Placement,
  to: number,
  into: Placement | null,
) {
  const out = into ?? scratch
  drift.moved = drift.turned = 0
  drift.leaped = drift.far = false
  for (let i = 0; i < hold.count; i++) {
    const action = hold.played[i].action
    lapOf(action, action.time + to * action.timeScale)
    if (place.lap !== from.lap[i]) {
      drift.far = true
      return FAR
    }
    out.lap[i] = place.lap
    out.hint[i] = from.hint[i]
    readAt(tables[i], place.at, out, i)
    drift.leaped ||= out.leaps[i] !== from.leaps[i]
    drift.moved += Math.abs(out.moved[i] - from.moved[i])
    drift.turned += Math.abs(out.turned[i] - from.turned[i])
  }
  return pixelsOfDrift(hold, root, view)
}

function copyDrift(from: Drift, to: Drift) {
  to.moved = from.moved
  to.turned = from.turned
  to.leaped = from.leaped
  to.far = from.far
}

/** The pixels `view` draws the drift in `drift` at. */
function pixelsOfDrift(hold: Hold, root: Object3D, view: HoldView) {
  if (drift.far) return FAR
  if (drift.leaped || !(drift.turned <= BLEND_SIN)) return Number.MAX_VALUE
  return pixelsOf(drift.moved, root, hold.reach!.radius, view)
}

/** `moved` metres, in the frame of `root`'s parent, as pixels at `view` (`screenErrorBound`, the
 *  cluster cut's certified bound): anywhere in the ball of `radius` about `root`'s origin as the
 *  last frame placed it, the parent stretching lengths by its largest axis. */
function pixelsOf(moved: number, root: Object3D, radius: number, view: HoldView) {
  if (!(moved > 0)) return moved === 0 ? 0 : Number.MAX_VALUE
  const m = root.matrixWorld.elements
  const x = m[12] - view.eye[0],
    y = m[13] - view.eye[1],
    z = m[14] - view.eye[2],
    depth = dotVector3Xyz(view.forward, x, y, z),
    lateral = Math.sqrt(Math.max(0, dotScalar3(x, y, z, x, y, z) - depth * depth))
  const stretch = root.parent ? root.parent.matrixWorld.getMaxScaleOnAxis() : 1
  const pixels = screenErrorBound(
    moved,
    stretch,
    lateral,
    depth,
    radius,
    view.focal,
    view.near,
    view.perspective,
  )
  return pixels < Infinity ? pixels : Number.MAX_VALUE
}
