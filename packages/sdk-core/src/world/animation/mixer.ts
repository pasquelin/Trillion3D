// Plays clips on the nodes under a root: what a world's loop advances each frame while an action
// plays. It reads what a clip is from `./clip.ts` rather than from the folder's barrel, so nothing
// has to reach back through one.
import type { Object3D } from '../object/object3d.ts'
import { Blends, type Blend } from './blend.ts'
import { clipTimeOf, trackWidth, type Clip, type Track, type TrackBinding } from './clip.ts'
import { difference, sample } from './sample.ts'
import {
  HELD,
  UNRECORDED,
  WRITE,
  WRITE_QUIET,
  holdFrame,
  holdWalk,
  holdWritten,
} from './mixerHold.ts'

/** Every mixer with an action playing: what a world's loop advances each frame. */
const playing = new Set<Mixer>()
/** The mixers `advanceMixers` walks this frame, copied first: an update may stop its own mixer. */
const advancing: Mixer[] = []

/** A track of an action bound once: what it writes, the blend of that property, and whether the
 *  property is a node's pose value its samples fill whole (`Blend.pose`). */
type Slot = { track: Track; binding: TrackBinding; blend: Blend; pose: boolean }
/** An action's slots, by the track's place in its clip, read by an update with no lookup;
 *  `alone` once known: whether every track is bound and no two write one property; `sampler`
 *  once asked: the lent sampler bound to its tracks, `null` when they do not pack. */
type Bound = {
  slots: (Slot | undefined)[]
  alone?: boolean
  sampler?: BoundSampler | null
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

/** Gives `action`'s lent sampler its room back: the next sample binds a new one. */
function releaseSampler(action: Action) {
  const bound = boundOf.get(action)
  bound?.sampler?.release()
  if (bound) bound.sampler = undefined
}

/** Samples tracks the JavaScript way (`sample`) into `out`, each from its offset. */
export type SampleInto = (t: number, out: Float64Array, offsets: Uint32Array) => void
/** A whole action's tracks bound to a lent sampler. */
export interface BoundSampler {
  /** Where each track's sample starts in what `sample` returns, from `at`. */
  readonly offsets: Uint32Array
  /** Where the numbers of the last `sample` start in what it returned: 0 in the sampler's own
   *  array, elsewhere in a frame's shared one (`ahead`). */
  readonly at: number
  /** Every track sampled at `t`: `sample`'s numbers bit for bit, valid until the next call. */
  sample(t: number): Float64Array
  /** Asks for the sample at `t` ahead of the next frame, a host that can take it meanwhile — a
   *  worker — handing it to the next `sample(t)`; that sample is computed then when it cannot. */
  ahead?(t: number): void
  /** Gives its room back. */
  release(): void
}
/** A sampler of whole actions on packed tracks, which a host with a faster one lends — the
 *  browser's WebAssembly sampler (`packages/sdk-browser/src/math/batchAnimation.ts`). */
export interface ActionSampler {
  /** A sampler of `tracks` in their order, `fallback` its JavaScript path; `undefined` when one
   *  of them does not pack. */
  bind(tracks: readonly Track[], fallback: SampleInto): BoundSampler | undefined
  /** Every mixer of the frame sampled: the samples asked ahead go, the ones handed are let go. */
  frame?(): void
}
let actionSampler: ActionSampler | null = null
/** Lends the sampler a lone action is sampled through (`null`: `sample`, track by track). */
export function lendActionSampler(sampler: ActionSampler | null) {
  actionSampler = sampler
}

/** The seconds the next frame is expected to advance by, while `advanceMixers` walks a frame on
 *  a step (`period`), else `null`: what each action asks ahead at. */
let aheadSeconds: number | null = null
/** `Mixer.update`'s step with its mode: `seeking` writes the true pose whatever the view. */
let stepMixer: (mixer: Mixer, seconds: number, seeking: boolean) => boolean
/** The delta of the last frame `advanceMixers` walked, and how many frames before it had it. */
let lastSeconds = NaN,
  repeats = 0
/** The step the frames advance by: a delta the last three frames repeated — a fixed step or a
 *  display's refresh grid, never a wall clock's chance —, kept while each later delta is a whole
 *  number of it (a frame the display dropped is two, a frame read twice none); else `null`. */
let period: number | null = null

/** Whether `seconds` is a whole number of `step`s, to the rounding of their sum. */
function onStep(seconds: number, step: number) {
  const steps = Math.round(seconds / step)
  return Math.abs(seconds - steps * step) <= 1e-9 * Math.max(seconds, step)
}

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

/** Every track of an action whose tracks are all bound (`allBound`), sampled at `time` through the
 *  lent sampler when they pack: `sample`'s numbers, each track's at `bound.sampler.offsets`;
 *  `undefined` without a sampler, the caller then sampling track by track. */
function sampledWhole(
  bound: Bound,
  tracks: readonly Track[],
  time: number,
  action: Action,
  quiet: boolean,
) {
  if (bound.sampler === undefined) {
    if (!actionSampler) return undefined
    const slots = bound.slots
    bound.sampler =
      actionSampler.bind(tracks, (t, out, offsets) => {
        for (let k = 0; k < tracks.length; k++)
          out.set(sample(tracks[k], t, slots[k]!.binding), offsets[k])
      }) ?? null
  }
  const sampler = bound.sampler
  if (!sampler) return undefined
  const whole = sampler.sample(time)
  // The next frame's clip time, by `advance`'s own sum: a delta or a state changed by then
  // gives another time, and the sample asked for it is not the one that frame takes.
  if (!quiet && action.playingNow) askAhead(action)
  return whole
}

/** Asks `action`'s sample of the next frame ahead, while frames step (`aheadSeconds`). */
function askAhead(action: Action) {
  const sampler = boundOf.get(action)?.sampler
  if (aheadSeconds !== null && sampler?.ahead)
    sampler.ahead(
      clipTimeOf(action.clip, action.loop, action.time + aheadSeconds * action.timeScale),
    )
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
    releaseSampler(this)
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
    const plan = seeking
      ? WRITE
      : holdFrame(this, this.actions, seconds, actionSampler && aheadSeconds, askAhead)
    if (plan === HELD) return true
    const active = this.#write(seconds, plan === WRITE_QUIET)
    if (plan !== UNRECORDED) holdWritten(this, this.actions)
    return active
  }
  /** `update`'s sample, blend and write of the true pose. */
  #write(seconds: number, quiet: boolean): boolean {
    let active = false,
      only: Action | undefined,
      count = 0
    for (const action of this.actions.values())
      if (action.playingNow && count++ === 0) only = action
    if (count === 1 && only!.weight === 1 && only!.blendMode === 'normal' && this.#alone(only!))
      return this.#updateAlone(only!, seconds, quiet)
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
      // Every track bound: sampled whole through the lent sampler, each sample in its binding.
      const whole = allBound(bound, tracks)
        ? sampledWhole(bound, tracks, time, action, quiet)
        : undefined
      if (whole) {
        const { offsets, at: base } = bound.sampler!
        for (let t = 0; t < tracks.length; t++) {
          const value = slots[t]!.binding.value,
            at = base + offsets[t]
          for (let c = 0; c < value.length; c++) value[c] = whole[at + c]
        }
      }
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
          bound.sampler?.release()
          bound.sampler = undefined
        }
        const { binding, blend } = slot,
          value = whole ? binding.value : sample(tr, time, binding)
        if (action.blendMode === 'normal') blends.add(blend, value, action.weight)
        else blends.addDifference(blend, difference(tr, value, binding.reference!), action.weight)
      }
      if (!action.playingNow) releaseSampler(action)
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
   * general path's result without its blend — every track sampled, through the lent sampler when
   * its tracks pack (`ActionSampler`), then each property set to its sample in the same order
   * (`Blend.writeAlone`).
   */
  #updateAlone(action: Action, seconds: number, quiet: boolean) {
    advance(action, seconds)
    const active = action.playingNow,
      time = action.clipTime(),
      tracks = action.clip.tracks,
      bound = boundOf.get(action)!,
      slots = bound.slots,
      out = sampledWhole(bound, tracks, time, action, quiet),
      offsets = out && bound.sampler!.offsets,
      base = out ? bound.sampler!.at : 0
    if (!out) for (let t = 0; t < tracks.length; t++) sample(tracks[t], time, slots[t]!.binding)
    const { widths, values, blends } = (bound.writes ??= writesOf(slots, tracks.length))
    for (let t = 0; t < tracks.length; t++) {
      const value = out ?? slots[t]!.binding.value,
        at = offsets ? base + offsets[t] : 0,
        pose = values[t]
      if (!pose) {
        blends[t].writeAlone(value, at)
        continue
      }
      // `Blend.writeAlone`'s value, `0 + 1 · v`, set straight into the node's pose value.
      for (let c = 0; c < widths[t]; c++) value[at + c] += 0
      if (widths[t] === 4) pose.set(value[at], value[at + 1], value[at + 2], value[at + 3])
      else pose.set(value[at], value[at + 1], value[at + 2])
    }
    if (!active) {
      releaseSampler(action)
      playing.delete(this)
    }
    return active
  }
}

/** Advances the mixers whose root hangs under `scene`; true while one of them still plays. A
 *  frame on a step (`period`) asks each action's next sample ahead one step on: after a frame the
 *  display dropped, the next is one step again, and its sample was asked for. */
export function advanceMixers(scene: Object3D, seconds: number) {
  let active = false
  // From the length found: a listener of a written pose that advances again stacks its own walk.
  const from = advancing.length,
    outer = from === 0
  if (outer) {
    repeats = seconds === lastSeconds ? repeats + 1 : 0
    lastSeconds = seconds
    if (repeats >= 2) period = seconds
    else if (period !== null && !onStep(seconds, period)) period = null
    aheadSeconds = period
    holdWalk(true)
  }
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
    if (outer) {
      aheadSeconds = null
      holdWalk(false)
    }
  }
  if (outer) actionSampler?.frame?.()
  return active
}
