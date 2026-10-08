import { wrap } from '../../../../math/src/scalar/reals.ts'
// What a clip is: the data a mixer plays, the slot a track's samples are written into, and where
// a clip stands at a time. It imports nothing — `sample.ts`, `wind.ts` and `mixerHold.ts` read
// from here, and none of them needs the module that plays a clip.

/** What a track animates: a number, a vector, a rotation, a colour, or a list of numbers — a
 *  mesh's morph weights, `node.morphTargetInfluences`. */
export type TrackKind = 'number' | 'vector' | 'quaternion' | 'color' | 'weights'

/** Values sampled at times: `values` holds `values.length / times.length` numbers per key. */
export interface Track {
  /** What it animates: `node.field`. */ readonly name: string
  /** What kind of value it holds. */ readonly kind: TrackKind
  /** When each key happens, in seconds. */ readonly times: Float32Array
  /** The value at each key, one after the other. */ readonly values: Float32Array
  /** How it goes from one key to the next: a straight line (the default), the earlier key held,
   *  or glTF's cubic spline, whose keys hold an in-tangent, the value and an out-tangent. */
  readonly interpolation?: 'linear' | 'step' | 'cubic'
}
/** A named animation: tracks played together. */ export interface Clip {
  /** The clip's name. */ readonly name: string
  /** How long the clip lasts, in seconds. */ readonly duration: number
  /** The tracks it plays. */ readonly tracks: Track[]
}

/** A track bound to what it writes: its owner and field, its last key, one sample's numbers. */
export type TrackBinding = {
  /** The object the track writes into. */ owner: Record<string, unknown>
  /** The field of `owner` it writes. */ field: string
  /** The key the last sample stood at. */ key: number
  /** The numbers of one sample. */ value: Float64Array
  /** Its clip's reference pose, the first key: what an additive action is measured from. */
  reference?: Float64Array
  /** The rotation's arc between key `arcKey` and the next (`slerpArc`): kept while the samples
   *  stay between those two keys, a clip's keys never rewritten. */
  arc?: Float64Array
  /** The key the arc starts at. */ arcKey?: number
}

/** The numbers one key of `tr` gives a sample: its values per key, a cubic spline's in-tangent and
 *  out-tangent not counted. */
export function trackWidth(tr: Track) {
  return tr.values.length / tr.times.length / (tr.interpolation === 'cubic' ? 3 : 1)
}

/** Where in `clip` an action of loop mode `loop` stands `time` seconds in: held at the end, wrapped
 *  round, or played back and forth. */
export function clipTimeOf(clip: Clip, loop: 'once' | 'repeat' | 'pingpong', time: number) {
  const d = clip.duration || 1
  if (loop === 'once') return Math.min(time, d)
  if (loop === 'repeat') return wrap(time, d)
  const phase = wrap(time, 2 * d)
  return phase > d ? 2 * d - phase : phase
}
