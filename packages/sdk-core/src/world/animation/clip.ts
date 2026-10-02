// What a clip is: the data a mixer plays, and the slot a track's samples are written into. It
// imports nothing — `sample.ts` and `wind.ts` read their types from here, and neither of them needs
// the module that plays a clip.

/** What a track animates: a number, a vector, a rotation, a colour, or a list of numbers — a
 *  mesh's morph weights, `node.morphTargetInfluences`. */
export type TrackKind = 'number' | 'vector' | 'quaternion' | 'color' | 'weights';

/** Values sampled at times: `values` holds `values.length / times.length` numbers per key. */
export interface Track {
  /** What it animates: `node.field`. */ readonly name: string;
  /** What kind of value it holds. */ readonly kind: TrackKind;
  /** When each key happens, in seconds. */ readonly times: Float32Array;
  /** The value at each key, one after the other. */ readonly values: Float32Array;
  /** How it goes from one key to the next: a straight line (the default), the earlier key held,
   *  or glTF's cubic spline, whose keys hold an in-tangent, the value and an out-tangent. */
  readonly interpolation?: 'linear' | 'step' | 'cubic';
}
/** A named animation: tracks played together. */ export interface Clip {
  /** The clip's name. */ readonly name: string;
  /** How long the clip lasts, in seconds. */ readonly duration: number;
  /** The tracks it plays. */ readonly tracks: Track[];
}

/** A track bound to what it writes: its owner and field, its last key, one sample's numbers. */
export type TrackBinding = {
  /** The object the track writes into. */ owner: Record<string, unknown>;
  /** The field of `owner` it writes. */ field: string;
  /** The key the last sample stood at. */ key: number;
  /** The numbers of one sample. */ value: Float64Array;
  /** Its clip's reference pose, the first key: what an additive action is measured from. */
  reference?: Float64Array;
};
