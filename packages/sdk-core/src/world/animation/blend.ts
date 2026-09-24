import { normalizeQuaternion } from '../../math/matrix/quaternion.ts';

type Held = Record<string, number> & {
  set?: (...v: number[]) => void;
  setRGB?: (r: number, g: number, b: number) => void;
};

/** One property the mixer's actions write: its rest value and this frame's weighted sum.
 *  The written value depends only on the actions' clip times and weights, never on the frame rate. */
export class Blend {
  /** The object the property belongs to. */ private readonly owner: Record<string, unknown>;
  /** The property's field on `owner`. */ private readonly field: string;
  /** Whether the values are rotations, blended on the unit sphere. */
  private readonly rotation: boolean;
  /** The value the property held when an action first bound it. */
  private readonly rest: Float64Array;
  /** This frame's sum of weighted samples. */ private readonly sum: Float64Array;
  /** This frame's sum of weights. */ private weight = 0;
  constructor(owner: Record<string, unknown>, field: string, rotation: boolean, size: number) {
    this.owner = owner;
    this.field = field;
    this.rotation = rotation;
    this.rest = new Float64Array(size);
    this.sum = new Float64Array(size);
    const held = owner[field] as Held | number;
    if (typeof held === 'number') this.rest[0] = held;
    else {
      const keys = held.setRGB ? ['r', 'g', 'b'] : ['x', 'y', 'z', 'w'];
      for (let c = 0; c < size; c++) this.rest[c] = held[keys[c]];
    }
  }
  /** Empties the frame's sum. */ clear() {
    this.sum.fill(0);
    this.weight = 0;
  }
  /** Adds one action's sample, counted `weight`; rotations on the sum's hemisphere. */
  add(value: ArrayLike<number>, weight: number) {
    let sign = 1;
    if (this.rotation) {
      let dot = 0;
      for (let c = 0; c < 4; c++) dot += this.sum[c] * value[c];
      sign = dot < 0 ? -1 : 1;
    }
    for (let c = 0; c < this.sum.length; c++) this.sum[c] += sign * weight * value[c];
    this.weight += weight;
  }
  /** Writes the blend: the weighted mean when the weights reach 1, else topped up by the rest. */
  write() {
    if (this.weight < 1) this.add(this.rest, 1 - this.weight);
    const out = this.sum;
    for (let c = 0; c < out.length; c++) out[c] /= this.weight;
    if (this.rotation) normalizeQuaternion(out);
    const held = this.owner[this.field] as Held | number;
    if (typeof held === 'number') this.owner[this.field] = out[0];
    else if (held.setRGB) held.setRGB(out[0], out[1], out[2]);
    else held.set?.(...out);
  }
}

/** What a track writes: an owner's field, sampled `value.length` numbers at a time. */
type Target = { owner: Record<string, unknown>; field: string; value: ArrayLike<number> };

/** The blends of one mixer: each property its actions write, by owner then field. */
export class Blends {
  private readonly byOwner = new Map<object, Map<string, Blend>>();
  /** Each track target's blend, found once. */
  private readonly byTarget = new Map<Target, Blend>();
  /** The blends this frame's actions touched. */ private readonly touched = new Set<Blend>();
  /** The blend of what `target` writes, made on first use with the value it holds as its rest;
   *  every track of the mixer on one property shares it. */
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
  /** Adds one action's sample to `blend` for this frame; a negative weight counts 0. */
  add(blend: Blend, value: ArrayLike<number>, weight: number) {
    if (!this.touched.has(blend)) {
      this.touched.add(blend);
      blend.clear();
    }
    blend.add(value, Math.max(0, weight));
  }
  /** Writes every blend touched this frame, then forgets them. */ write() {
    for (const blend of this.touched) blend.write();
    this.touched.clear();
  }
}
