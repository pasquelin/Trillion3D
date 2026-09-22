import type { Object3D } from '../object/object3d.ts';

/** What a track animates: a number, a vector, a rotation or a colour. */
export type TrackKind = 'number' | 'vector' | 'quaternion' | 'color';

/** Values sampled at times: `values` holds `values.length / times.length` numbers per key. */
export interface Track {
  readonly name: string;
  readonly kind: TrackKind;
  readonly times: Float32Array;
  readonly values: Float32Array;
}
export interface Clip {
  readonly name: string;
  readonly duration: number;
  readonly tracks: Track[];
}

const track =
  (kind: TrackKind) =>
  (path: string, times: number[], values: number[]): Track => ({
    name: path,
    kind,
    times: new Float32Array(times),
    values: new Float32Array(values),
  });

/** Every mixer with an action playing: what a world's loop advances each frame. */
const playing = new Set<Mixer>();

/** `path` = `node.property[.property…]`; an empty node is the mixer's root. */
function resolve(root: Object3D, path: string) {
  const [node, ...fields] = path.split('.');
  let owner: Record<string, unknown> = (node ? root.getObjectByName(node) : root) as never;
  for (const field of fields.slice(0, -1)) owner = owner?.[field] as Record<string, unknown>;
  return owner ? { owner, field: fields[fields.length - 1] } : null;
}

/** The track's value at `t`, linearly between the two keys around it; quaternions on the arc. */
function sample(tr: Track, t: number, out: number[]) {
  const { times, values } = tr,
    size = values.length / times.length;
  let i = 0;
  while (i < times.length - 1 && times[i + 1] < t) i++;
  const j = Math.min(i + 1, times.length - 1);
  const span = times[j] - times[i],
    w = span > 0 ? Math.min(1, Math.max(0, (t - times[i]) / span)) : 0;
  let sign = 1;
  if (tr.kind === 'quaternion') {
    let dot = 0;
    for (let c = 0; c < 4; c++) dot += values[i * 4 + c] * values[j * 4 + c];
    sign = dot < 0 ? -1 : 1;
  }
  for (let c = 0; c < size; c++)
    out[c] = values[i * size + c] * (1 - w) + sign * values[j * size + c] * w;
  if (tr.kind === 'quaternion') {
    const l = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
    for (let c = 0; c < 4; c++) out[c] /= l;
  }
  return out;
}

/** One clip playing on a mixer's root. */
export class Action {
  loop: 'once' | 'repeat' | 'pingpong' = 'repeat';
  weight = 1;
  timeScale = 1;
  time = 0;
  playingNow = false;
  readonly mixer: Mixer;
  readonly clip: Clip;
  constructor(mixer: Mixer, clip: Clip) {
    this.mixer = mixer;
    this.clip = clip;
  }
  play() {
    this.playingNow = true;
    playing.add(this.mixer);
    this.mixer.root._link?.pose(this.mixer.root);
    return this;
  }
  stop() {
    this.playingNow = false;
    this.time = 0;
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
  readonly root: Object3D;
  constructor(root: Object3D) {
    this.root = root;
  }
  clipAction(clip: Clip) {
    let action = this.actions.get(clip);
    if (!action) this.actions.set(clip, (action = new Action(this, clip)));
    return action;
  }
  play(clip: Clip) {
    return this.clipAction(clip).play();
  }
  stopAll() {
    for (const action of this.actions.values()) action.stop();
    playing.delete(this);
  }
  /** Advances every playing action by `seconds` and writes the sampled values. */
  update(seconds: number) {
    const out: number[] = [];
    let active = false;
    for (const action of this.actions.values()) {
      if (!action.playingNow) continue;
      action.time += seconds * action.timeScale;
      if (action.loop === 'once' && action.time >= action.clip.duration) action.playingNow = false;
      active ||= action.playingNow;
      for (const tr of action.clip.tracks) {
        const target = resolve(this.root, tr.name);
        if (!target) continue;
        const value = sample(tr, action.clipTime(), out);
        const held = target.owner[target.field] as { set?: (...v: number[]) => void } | number;
        if (typeof held === 'number')
          target.owner[target.field] = held + (value[0] - held) * action.weight;
        else if (tr.kind === 'color')
          (held as { setRGB(r: number, g: number, b: number): void }).setRGB(
            value[0],
            value[1],
            value[2],
          );
        else held?.set?.(...value);
      }
    }
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

/** The `animation` family: clips of keyed tracks, played by a mixer on a node and its children. */
export const animation = {
  createMixer: (root: Object3D) => new Mixer(root),
  clip: (name: string, duration: number, tracks: Track[]): Clip => ({ name, duration, tracks }),
  track: track('number'),
  numberTrack: track('number'),
  vectorTrack: track('vector'),
  quaternionTrack: track('quaternion'),
  colorTrack: track('color'),
};
