// Plays clips on the nodes under a root: what a world's loop advances each frame while an action
// plays. It reads what a clip is from `./clip.ts` rather than from the folder's barrel, so nothing
// has to reach back through one.
import type { Object3D } from '../object/object3d.ts'
import { Blends, type Blend } from './blend.ts'
import { clipTimeOf, trackWidth, type Clip, type Track, type TrackBinding } from './clip.ts'
import { difference, sample } from './sample.ts'
import { HELD, UNRECORDED, WRITE, holdFrame, holdWalk, holdWritten } from './mixerHold.ts'
import { advanceBankClocks } from './bankClock.ts'

/** Every mixer with an action playing: what a world's loop advances each frame. */
const playing = new Set<Mixer>()
/** The mixers `advanceMixers` walks this frame, copied first: an update may stop its own mixer. */
const advancing: Mixer[] = []

/** A track of an action bound once: what it writes, the blend of that property, and whether the
 *  property is a node's pose value its samples fill whole (`Blend.pose`). */
type Slot = { track: Track; binding: TrackBinding; blend: Blend; pose: boolean }
/** An action's slots, by the track's place in its clip, read by an update with no lookup;
 *  `alone` once known: whether every track is bound and no two write one property. */
type Bound = {
  slots: (Slot | undefined)[]
  alone?: boolean
  writes?: Writes
}

/** A node's position or scale, or its quaternion: what a pose track sets, number by number. */
type PoseValue = { set(x: number, y: number, z: number, w?: number): unknown }

/** How each track of a lone action writes its property, in flat arrays read in track order:
 *  through its blend (`Blend.writeAlone`), or straight into the node's pose value (`values`). */
type Writes = {
  widths: Uint8Array
  values: (PoseValue | undefined)[]
  blends: Blend[]
}

/** The flat write arrays of `slots`, every one bound. */
function writesOf(slots: (Slot | undefined)[], n: number): Writes {
  const writes: Writes = { widths: new Uint8Array(n), values: [], blends: [] }
  for (let t = 0; t < n; t++) {
    const { binding, blend, pose } = slots[t]!
    writes.widths[t] = binding.value.length
    writes.values.push(pose ? (binding.owner[binding.field] as PoseValue) : undefined)
    writes.blends.push(blend)
  }
  return writes
}
const boundOf = new WeakMap<Action, Bound>()

/** `Mixer.update`'s step with its mode: `seeking` writes the true pose whatever the view. */
let stepMixer: (mixer: Mixer, seconds: number, seeking: boolean) => boolean

/** Advances `action` by `seconds`; a `'once'` action past its end stops, sampled one last time. */
function advance(action: Action, seconds: number) {
  action.time += seconds * action.timeScale
  if (action.loop === 'once' && action.time >= action.clip.duration) action.playingNow = false
}

/** Whether `bound`'s slots hold every track of `tracks`, each on a property of its own. */
function aloneOf(bound: Bound, tracks: readonly Track[]) {
  if (!allBound(bound, tracks)) return false
  const { slots } = bound
  if (bound.alone === undefined) {
    const blends = new Set<Blend>()
    for (let t = 0; t < tracks.length; t++) blends.add(slots[t]!.blend)
    bound.alone = blends.size === tracks.length
  }
  return bound.alone
}

/** Whether `bound`'s slots hold every track of `tracks`, in its place. */
function allBound(bound: Bound, tracks: readonly Track[]) {
  for (let t = 0; t < tracks.length; t++) if (bound.slots[t]?.track !== tracks[t]) return false
  return true
}

/** `path` = `node.property[.property…]`; an empty node is the mixer's root. */
function resolve(root: Object3D, path: string) {
  const [node, ...fields] = path.split('.')
  let owner: Record<string, unknown> = (node ? root.getObjectByName(node) : root) as never
  for (const field of fields.slice(0, -1)) owner = owner?.[field] as Record<string, unknown>
  return owner ? { owner, field: fields[fields.length - 1] } : null
}

/** One clip playing on a mixer's root. */
export class Action {
  /** What happens at the end: stop, start again, or go back. */
  loop: 'once' | 'repeat' | 'pingpong' = 'repeat'
  /** How much this action counts, 0 to 1. */ weight = 1
  /** `'additive'` adds the clip's motion from its first key on top of what the other actions
   *  write — a nod over a walk —, instead of blending with them. */
  blendMode: 'normal' | 'additive' = 'normal'
  /** Speed: 2 plays twice as fast. */ timeScale = 1
  /** Seconds played so far. */ time = 0
  /** Whether the action is playing. */ playingNow = false
  /** The mixer that plays it. */ readonly mixer: Mixer
  /** The clip it plays. */ readonly clip: Clip
  /** Each track's binding, made on the first sample that finds its target. */
  private readonly bindings = new Map<Track, TrackBinding>()
  constructor(mixer: Mixer, clip: Clip) {
    this.mixer = mixer
    this.clip = clip
  }
  /** What `tr` writes, resolved once; null while its target is not under the root. */
  bindingOf(tr: Track) {
    let bound = this.bindings.get(tr)
    if (bound) return bound
    const target = resolve(this.mixer.root, tr.name)
    if (!target) return null
    const value = new Float64Array(trackWidth(tr))
    this.bindings.set(tr, (bound = { ...target, key: 0, value }))
    bound.reference = Float64Array.from(sample(tr, tr.times[0] ?? 0, bound))
    return bound
  }
  /** Starts playing. */ play() {
    this.playingNow = true
    playing.add(this.mixer)
    this.mixer.root._link?.pose(this.mixer.root)
    return this
  }
  /** Stops, and goes back to the start. */ stop() {
    this.playingNow = false
    this.time = 0
    return this
  }
  /** Poses the clip at `time` seconds now, by its loop mode, playing or not: a playing action goes
   *  on from there, a stopped one keeps the pose until a playing action of its mixer writes over it. */
  seek(time: number) {
    const was = this.playingNow
    this.time = time
    this.playingNow = true
    stepMixer(this.mixer, 0, true)
    this.playingNow = was && this.playingNow
    return this
  }
  /** Where in the clip the action stands, by its loop mode. */
  clipTime() {
    return clipTimeOf(this.clip, this.loop, this.time)
  }
}

/** Plays clips on the nodes under `root`; a world's loop advances it while an action plays. */
export class Mixer {
  private readonly actions = new Map<Clip, Action>()
  /** The properties its actions write, blended each update; `#` keeps the type off the API. */
  readonly #blends = new Blends()
  /** The node whose children it animates. */ readonly root: Object3D
  constructor(root: Object3D) {
    this.root = root
  }
  /** The action that plays `clip`. */ clipAction(clip: Clip) {
    let action = this.actions.get(clip)
    if (!action) this.actions.set(clip, (action = new Action(this, clip)))
    return action
  }
  /** Plays `clip` now. */ play(clip: Clip) {
    return this.clipAction(clip).play()
  }
  /** Stops every action. */ stopAll() {
    for (const action of this.actions.values()) action.stop()
    playing.delete(this)
  }
  /** Advances every playing action by `seconds`, then writes each property the weighted blend of
   *  its actions' samples over its rest value — unless the view of its scene keeps the pose last
   *  written within half a pixel of that blend (`mixerHold.ts`): the times alone advance then. */
  update(seconds: number): boolean {
    return stepMixer(this, seconds, false)
  }
  static {
    stepMixer = (mixer, seconds, seeking) => mixer.#step(seconds, seeking)
  }
  /** `update`, in the mode of a seek or not. */
  #step(seconds: number, seeking: boolean): boolean {
    const plan = seeking ? WRITE : holdFrame(this, this.actions, seconds)
    if (plan === HELD) return true
    const active = this.#write(seconds)
    if (plan !== UNRECORDED) holdWritten(this, this.actions)
    return active
  }
  /** `update`'s sample, blend and write of the true pose. */
  #write(seconds: number): boolean {
    let active = false,
      only: Action | undefined,
      count = 0
    for (const action of this.actions.values())
      if (action.playingNow && count++ === 0) only = action
    if (count === 1 && only!.weight === 1 && only!.blendMode === 'normal' && this.#alone(only!))
      return this.#updateAlone(only!, seconds)
    const blends = this.#blends
    for (const action of this.actions.values()) {
      if (!action.playingNow) continue
      advance(action, seconds)
      active ||= action.playingNow
      const time = action.clipTime(),
        tracks = action.clip.tracks
      let bound = boundOf.get(action)
      if (!bound) boundOf.set(action, (bound = { slots: [] }))
      const slots = bound.slots
      for (let t = 0; t < tracks.length; t++) {
        const tr = tracks[t]
        let slot = slots[t]
        if (slot?.track !== tr) {
          // Bound on the first update that finds the target; a track moved in the clip binds again.
          const target = action.bindingOf(tr)
          if (!target) continue
          const blend = blends.of(target, tr.kind === 'quaternion')
          slots[t] = slot = {
            track: tr,
            binding: target,
            blend,
            pose: target.value.length === blend.size && blend.pose,
          }
          bound.alone = undefined
          bound.writes = undefined
        }
        const { binding, blend } = slot,
          value = sample(tr, time, binding)
        if (action.blendMode === 'normal') blends.add(blend, value, action.weight)
        else blends.addDifference(blend, difference(tr, value, binding.reference!), action.weight)
      }
    }
    blends.write()
    if (!active) playing.delete(this)
    return active
  }
  /** Whether `action`, the only one playing, at weight 1, writes each property it binds alone. */
  #alone(action: Action) {
    const bound = boundOf.get(action)
    return bound !== undefined && aloneOf(bound, action.clip.tracks)
  }
  /**
   * The update of a mixer whose only action plays at weight 1 and writes each property alone: the
   * general path's result without its blend — every track sampled, then each property set to its
   * sample in the same order (`Blend.writeAlone`).
   */
  #updateAlone(action: Action, seconds: number) {
    advance(action, seconds)
    const active = action.playingNow,
      time = action.clipTime(),
      tracks = action.clip.tracks,
      bound = boundOf.get(action)!,
      slots = bound.slots
    const { widths, values, blends } = (bound.writes ??= writesOf(slots, tracks.length))
    for (let t = 0; t < tracks.length; t++) {
      const value = sample(tracks[t], time, slots[t]!.binding),
        pose = values[t]
      if (!pose) {
        blends[t].writeAlone(value, 0)
        continue
      }
      // `Blend.writeAlone`'s value, `0 + 1 · v`, set straight into the node's pose value.
      for (let c = 0; c < widths[t]; c++) value[c] += 0
      if (widths[t] === 4) pose.set(value[0], value[1], value[2], value[3])
      else pose.set(value[0], value[1], value[2])
    }
    if (!active) playing.delete(this)
    return active
  }
}

/** Advances the mixers whose root hangs under `scene`, and the clocks of the animation banks one of
 *  whose owners it holds (`advanceBankClocks`); true while one of them still plays. */
export function advanceMixers(scene: Object3D, seconds: number) {
  let active = advanceBankClocks(scene, seconds)
  // From the length found: a listener of a written pose that advances again stacks its own walk.
  const from = advancing.length,
    outer = from === 0
  if (outer) holdWalk(true)
  try {
    for (const mixer of playing) advancing.push(mixer)
    const to = advancing.length
    for (let i = from; i < to; i++) {
      const mixer = advancing[i]
      let node: Object3D | null = mixer.root
      while (node && node !== scene) node = node.parent
      if (node) active = mixer.update(seconds) || active
    }
  } finally {
    advancing.length = from
    if (outer) holdWalk(false)
  }
  return active
}
