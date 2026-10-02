// Plays clips on the nodes under a root: what a world's loop advances each frame while an action
// plays. It reads what a clip is from `./clip.ts` rather than from the folder's barrel, so nothing
// has to reach back through one.
import type { Object3D } from '../object/object3d.ts';
import { Blends } from './blend.ts';
import type { Clip, Track, TrackBinding } from './clip.ts';
import { difference, sample } from './sample.ts';

/** Every mixer with an action playing: what a world's loop advances each frame. */
const playing = new Set<Mixer>();

/** `path` = `node.property[.property…]`; an empty node is the mixer's root. */
function resolve(root: Object3D, path: string) {
  const [node, ...fields] = path.split('.');
  let owner: Record<string, unknown> = (node ? root.getObjectByName(node) : root) as never;
  for (const field of fields.slice(0, -1)) owner = owner?.[field] as Record<string, unknown>;
  return owner ? { owner, field: fields[fields.length - 1] } : null;
}

/** One clip playing on a mixer's root. */
export class Action {
  /** What happens at the end: stop, start again, or go back. */
  loop: 'once' | 'repeat' | 'pingpong' = 'repeat';
  /** How much this action counts, 0 to 1. */ weight = 1;
  /** `'additive'` adds the clip's motion from its first key on top of what the other actions
   *  write — a nod over a walk —, instead of blending with them. */
  blendMode: 'normal' | 'additive' = 'normal';
  /** Speed: 2 plays twice as fast. */ timeScale = 1;
  /** Seconds played so far. */ time = 0;
  /** Whether the action is playing. */ playingNow = false;
  /** The mixer that plays it. */ readonly mixer: Mixer;
  /** The clip it plays. */ readonly clip: Clip;
  /** Each track's binding, made on the first sample that finds its target. */
  private readonly bindings = new Map<Track, TrackBinding>();
  constructor(mixer: Mixer, clip: Clip) {
    this.mixer = mixer;
    this.clip = clip;
  }
  /** What `tr` writes, resolved once; null while its target is not under the root. */
  bindingOf(tr: Track) {
    let bound = this.bindings.get(tr);
    if (bound) return bound;
    const target = resolve(this.mixer.root, tr.name);
    if (!target) return null;
    const width = tr.values.length / tr.times.length / (tr.interpolation === 'cubic' ? 3 : 1);
    const value = new Float64Array(width);
    this.bindings.set(tr, (bound = { ...target, key: 0, value }));
    bound.reference = Float64Array.from(sample(tr, tr.times[0] ?? 0, bound));
    return bound;
  }
  /** Starts playing. */ play() {
    this.playingNow = true;
    playing.add(this.mixer);
    this.mixer.root._link?.pose(this.mixer.root);
    return this;
  }
  /** Stops, and goes back to the start. */ stop() {
    this.playingNow = false;
    this.time = 0;
    return this;
  }
  /** Poses the clip at `time` seconds now, by its loop mode, playing or not: a playing action goes
   *  on from there, a stopped one keeps the pose until a playing action of its mixer writes over it. */
  seek(time: number) {
    const was = this.playingNow;
    this.time = time;
    this.playingNow = true;
    this.mixer.update(0);
    this.playingNow = was && this.playingNow;
    return this;
  }
  /** Where in the clip the action stands, by its loop mode. */
  clipTime() {
    const d = this.clip.duration || 1;
    if (this.loop === 'once') return Math.min(this.time, d);
    if (this.loop === 'repeat') return ((this.time % d) + d) % d;
    const phase = ((this.time % (2 * d)) + 2 * d) % (2 * d);
    return phase > d ? 2 * d - phase : phase;
  }
}

/** Plays clips on the nodes under `root`; a world's loop advances it while an action plays. */
export class Mixer {
  private readonly actions = new Map<Clip, Action>();
  /** The properties its actions write, blended each update; `#` keeps the type off the API. */
  readonly #blends = new Blends();
  /** The node whose children it animates. */ readonly root: Object3D;
  constructor(root: Object3D) {
    this.root = root;
  }
  /** The action that plays `clip`. */ clipAction(clip: Clip) {
    let action = this.actions.get(clip);
    if (!action) this.actions.set(clip, (action = new Action(this, clip)));
    return action;
  }
  /** Plays `clip` now. */ play(clip: Clip) {
    return this.clipAction(clip).play();
  }
  /** Stops every action. */ stopAll() {
    for (const action of this.actions.values()) action.stop();
    playing.delete(this);
  }
  /** Advances every playing action by `seconds`, then writes each property the weighted blend of
   *  its actions' samples over its rest value. */
  update(seconds: number): boolean {
    let active = false;
    const blends = this.#blends;
    for (const action of this.actions.values()) {
      if (!action.playingNow) continue;
      action.time += seconds * action.timeScale;
      if (action.loop === 'once' && action.time >= action.clip.duration) action.playingNow = false;
      active ||= action.playingNow;
      const time = action.clipTime();
      for (const tr of action.clip.tracks) {
        const target = action.bindingOf(tr);
        if (!target) continue;
        const blend = blends.of(target, tr.kind === 'quaternion'),
          value = sample(tr, time, target);
        if (action.blendMode === 'normal') blends.add(blend, value, action.weight);
        else blends.addDifference(blend, difference(tr, value, target.reference!), action.weight);
      }
    }
    blends.write();
    if (!active) playing.delete(this);
    return active;
  }
}

/** Advances the mixers whose root hangs under `scene`; true while one of them still plays. */
export function advanceMixers(scene: Object3D, seconds: number) {
  let active = false;
  for (const mixer of [...playing]) {
    let node: Object3D | null = mixer.root;
    while (node && node !== scene) node = node.parent;
    if (node) active = mixer.update(seconds) || active;
  }
  return active;
}
