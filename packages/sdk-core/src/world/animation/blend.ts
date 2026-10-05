import { multiplyQuaternion, normalizeQuaternion } from '../../math/matrix/quaternion.ts';
import { POSITION_VALUES, QUATERNION_VALUES } from '../../math/batch/strides.ts';

/** The width of each pose value of a node, by its field: a scale has a position's. */
const POSE_WIDTHS = {
  position: POSITION_VALUES,
  quaternion: QUATERNION_VALUES,
  scale: POSITION_VALUES,
} as const;

/** One partial turn of an additive rotation, rewritten per use. */
const turn = new Float64Array(4);

type Held = Record<string, number> & {
  set?: (...v: number[]) => void;
  setRGB?: (r: number, g: number, b: number) => void;
};

/**
 * One property the mixer's actions write: its rest value, this frame's weighted sum of the actions
 * that replace it, and the sum of those that add to it (`additive`). The written value depends
 * only on the actions' clip times and weights, never on the frame rate. A property may be a
 * number, a vector, a rotation, a colour, or a list of numbers — a mesh's morph weights.
 */
export class Blend {
  /** The object the property belongs to. */ private readonly owner: Record<string, unknown>;
  /** The property's field on `owner`. */ private readonly field: string;
  /** Whether the values are rotations, blended on the unit sphere. */
  private readonly rotation: boolean;
  /** The value the property held when an action first bound it. */
  private readonly rest: Float64Array;
  /** This frame's sum of weighted samples. */ private readonly sum: Float64Array;
  /** This frame's sum of weights. */ private weight = 0;
  /** This frame's additive part: a sum of weighted differences, or a product of partial turns. */
  private readonly added: Float64Array;
  /** Whether an additive action touched it this frame. */ private adds = false;
  /** Whether `sum` holds this frame's first sample yet: until then it reads as zeros. */
  private filled = false;
  /** Whether `sum` holds exactly one sample. */ private single = false;
  /** The update of its `Blends` that last touched it. */ touchedAt = 0;
  /** Whether the property is a node's position, quaternion or scale of the right width: the value
   *  the mixer sets straight from its samples, without this blend's sums (`mixer.ts`). */
  readonly pose: boolean;
  /** How many numbers the property holds. */ readonly size: number;
  constructor(owner: Record<string, unknown>, field: string, rotation: boolean, size: number) {
    this.owner = owner;
    this.field = field;
    this.rotation = rotation;
    this.rest = new Float64Array(size);
    this.sum = new Float64Array(size);
    this.added = new Float64Array(size);
    this.size = size;
    this.pose =
      (owner as { isObject3D?: boolean }).isObject3D === true &&
      size === POSE_WIDTHS[field as keyof typeof POSE_WIDTHS];
    const held = owner[field] as Held | number | number[];
    if (typeof held === 'number') this.rest[0] = held;
    else if (Array.isArray(held)) this.rest.set(held.slice(0, size));
    else {
      const keys = held.setRGB ? ['r', 'g', 'b'] : ['x', 'y', 'z', 'w'];
      for (let c = 0; c < size; c++) this.rest[c] = held[keys[c]];
    }
  }
  /** Empties the frame's sums: the first sample and the first difference then write over them. */
  clear() {
    this.weight = 0;
    this.filled = false;
    this.single = false;
    this.adds = false;
  }
  /** Adds one action's sample, counted `weight`; rotations on the sum's hemisphere. A rotation
   *  arrives unit, as `sample` gives it: alone at weight 1 it is written as it is. */
  add(value: ArrayLike<number>, weight: number) {
    this.single = !this.filled;
    if (!this.filled) {
      // Into a zero sum: no hemisphere to keep, and `0 + x` is `x`, a negative zero made positive.
      this.filled = true;
      for (let c = 0; c < this.sum.length; c++) this.sum[c] = weight * value[c] + 0;
      this.weight += weight;
      return;
    }
    let sign = 1;
    if (this.rotation) {
      let dot = 0;
      for (let c = 0; c < 4; c++) dot += this.sum[c] * value[c];
      sign = dot < 0 ? -1 : 1;
    }
    for (let c = 0; c < this.sum.length; c++) this.sum[c] += sign * weight * value[c];
    this.weight += weight;
  }
  /** Adds an additive action's difference to its clip's reference pose, counted `weight`: a
   *  vector's difference scaled, a rotation's partial turn from identity composed on. */
  addDifference(difference: ArrayLike<number>, weight: number) {
    if (!this.adds) {
      this.added.fill(0);
      if (this.rotation) this.added[3] = 1;
    }
    this.adds = true;
    if (!this.rotation) {
      for (let c = 0; c < this.added.length; c++) this.added[c] += weight * difference[c];
      return;
    }
    const sign = difference[3] < 0 ? -1 : 1;
    for (let c = 0; c < 4; c++) turn[c] = sign * weight * difference[c];
    turn[3] += 1 - weight;
    normalizeQuaternion(turn);
    multiplyQuaternion(this.added, this.added, turn);
  }
  /** Writes the blend: the weighted mean when the weights reach 1, else topped up by the rest,
   *  then the additive part on top. */
  write() {
    // One unit sample at weight 1, nothing added on top: already unit, normalised once only.
    const unit = this.rotation && this.single && this.weight === 1 && !this.adds;
    if (this.weight < 1) this.add(this.rest, 1 - this.weight);
    const out = this.sum;
    // A division by exactly 1 changes no bit.
    if (this.weight !== 1) for (let c = 0; c < out.length; c++) out[c] /= this.weight;
    if (this.adds && this.rotation) multiplyQuaternion(out, out, this.added);
    else if (this.adds) for (let c = 0; c < out.length; c++) out[c] += this.added[c];
    if (this.rotation && !unit) normalizeQuaternion(out);
    this.publish(out);
  }
  /** What `clear`, `add(value, 1)` then `write` give when `value` is the property's only sample of
   *  the update, at weight 1, with nothing additive: the sample as it is, `0 + 1 · v` (a negative
   *  zero made positive), a rotation already unit as `sample` gives it. */
  writeAlone(value: ArrayLike<number>, at = 0) {
    const out = this.sum;
    for (let c = 0; c < out.length; c++) out[c] = value[at + c] + 0;
    this.publish(out);
  }
  /** Sets the property to `out`. */
  private publish(out: Float64Array) {
    const held = this.owner[this.field] as Held | number | number[];
    if (typeof held === 'number') this.owner[this.field] = out[0];
    else if (Array.isArray(held)) for (let c = 0; c < out.length; c++) held[c] = out[c];
    else if (held.setRGB) held.setRGB(out[0], out[1], out[2]);
    // Each number passed by name: spreading a typed array walks its iterator.
    else if (!held.set) return;
    else if (out.length === 4) held.set(out[0], out[1], out[2], out[3]);
    else if (out.length === 3) held.set(out[0], out[1], out[2]);
    else held.set(...out);
  }
}

/** What a track writes: an owner's field, sampled `value.length` numbers at a time. */
type Target = { owner: Record<string, unknown>; field: string; value: ArrayLike<number> };

/** The blends of one mixer: each property its actions write, by owner then field. */
export class Blends {
  private readonly byOwner = new Map<object, Map<string, Blend>>();
  /** Each track target's blend, found once. */
  private readonly byTarget = new Map<Target, Blend>();
  /** The blends this update's actions touched, in the order they were first touched. */
  private readonly touched: Blend[] = [];
  /** This update's number: a blend whose `touchedAt` differs has not been touched yet. */
  private update = 1;
  /** The blend of what `target` writes, made on first use with the value it holds as its rest;
   *  every track of the mixer on one property shares it. Its caller keeps it (`mixer.ts`). */
  of(target: Target, rotation: boolean) {
    let blend = this.byTarget.get(target);
    if (blend) return blend;
    const { owner, field, value } = target;
    let fields = this.byOwner.get(owner);
    if (!fields) this.byOwner.set(owner, (fields = new Map()));
    blend = fields.get(field);
    if (!blend) fields.set(field, (blend = new Blend(owner, field, rotation, value.length)));
    this.byTarget.set(target, blend);
    return blend;
  }
  /** The blend, emptied if this update had not touched it yet. */
  private touch(blend: Blend) {
    if (blend.touchedAt !== this.update) {
      blend.touchedAt = this.update;
      this.touched.push(blend);
      blend.clear();
    }
    return blend;
  }
  /** Adds one action's sample to `blend` for this frame; a negative weight counts 0. */
  add(blend: Blend, value: ArrayLike<number>, weight: number) {
    this.touch(blend).add(value, Math.max(0, weight));
  }
  /** Adds an additive action's difference to `blend` for this frame. */
  addDifference(blend: Blend, difference: ArrayLike<number>, weight: number) {
    this.touch(blend).addDifference(difference, Math.max(0, weight));
  }
  /** Writes every blend touched this update, then forgets them. */ write() {
    const touched = this.touched;
    for (let i = 0; i < touched.length; i++) touched[i].write();
    touched.length = 0;
    this.update++;
  }
}
