import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import { keptBefore, type TickRecords } from '../protocol.ts'

/** Where a thing's state a step before its newest comes from, as a tick brings it (`take`). */
export const FROM = {
  /** A tick of no step left it as it was: its two states stand. */
  kept: 0,
  /** A tick of no step moved it in place: the newest itself, drawn at once. */
  newest: 1,
  /** The tick took that step too and kept its state of it (`keptBefore`). */
  before: 2,
  /** Still on its way: its newest of the tick before, a step behind. */
  last: 3,
  /** At rest, or new: where it is drawn now. */
  drawn: 4,
} as const

/** A drawn thing's two states (`createTwoSteps`): a step before its newest, and its newest. */
type States = { from: Float32Array | Float64Array; to: Float32Array | Float64Array }

/** The keys on their way, the tick that last brought each, and the tick being read
 *  (`createTwoSteps`). */
function createStepState(capacity: number) {
  return {
    listed: new Uint8Array(capacity),
    stamp: new Uint32Array(capacity),
    moving: new Int32Array(capacity),
    count: 0,
    tick: 0,
    stepped: false,
  }
}
type StepState = ReturnType<typeof createStepState>

/**
 * The tick brought `key`: `before` when it kept its state a step before, `fresh` when it is
 * another thing than the one listed under it, `same` when its newest is the one it already
 * holds. Returns where its earlier state comes from; listed but `FROM.kept`.
 */
function takeKey(s: StepState, key: number, before: boolean, fresh: boolean, same: boolean) {
  const { listed, moving, stepped } = s
  if (!stepped && same) return FROM.kept
  const from = !stepped
    ? FROM.newest
    : before
      ? FROM.before
      : listed[key] && !fresh
        ? FROM.last
        : FROM.drawn
  s.stamp[key] = s.tick
  if (!listed[key]) moving[s.count++] = key
  listed[key] = 1
  return from
}

/** The listed keys `alive` says are not what they were drawn by leave the list. */
function pruneKeys(s: StepState, alive: (key: number) => boolean) {
  const { listed, moving, count } = s
  let kept = 0
  for (let i = 0; i < count; i++) {
    const key = moving[i]
    if (alive(key)) moving[kept++] = key
    else listed[key] = 0
  }
  s.count = kept
}

/** After a frame at `t`: whether the keys are still on their way, else the list empties. */
function settleKeys(s: StepState, t: number, waiting: boolean) {
  if (t < 1 || waiting) return s.count > 0
  for (let i = 0; i < s.count; i++) s.listed[s.moving[i]] = 0
  s.count = 0
  return false
}

/** After a stepped tick, `land(key)` draws each listed key it did not bring on its newest
 *  state, and the key leaves the list. */
function landKeys(s: StepState, land: (key: number) => void) {
  const { listed, moving, stamp, count } = s
  let kept = 0
  for (let i = 0; i < count; i++) {
    const key = moving[i]
    if (stamp[key] === s.tick) moving[kept++] = key
    else {
      land(key)
      listed[key] = 0
    }
  }
  s.count = kept
}

/**
 * THE TWO STEPS EVERYTHING THE PHYSICS DRAWS IS DRAWN BETWEEN: a body's pose (`../poses.ts`), a
 * vehicle's wheels (`../vehicles/vehicles.ts`), a soft body's vertices (`../soft/softVertices.ts`), the character's feet
 * (`../character/physicsCharacter.ts`). Each is kept, under a key below `capacity`, as its state at the newest
 * step a tick brought and its state a step before (`FROM`), in its drawer's own store; every frame
 * draws all of them at the one fraction `t` of that step the frame's time stands at (`along`,
 * read once by the session), past 1 moved on from the newest while the page waits for the next.
 * This keeps which keys are on their way and where their earlier state comes from. A key a
 * stepped tick says nothing of stands where its last step left it: drawn there (`end`), it leaves
 * the list; once the time drawn is past every newest and nothing is awaited, the list empties.
 */
export function createTwoSteps(capacity: number) {
  const s = createStepState(capacity)
  const take = (key: number, before: boolean, fresh: boolean, same: boolean) =>
    takeKey(s, key, before, fresh, same)
  return {
    /** Whether `key` is on its way. */
    listed: (key: number) => s.listed[key] === 1,
    /** A tick of `steps` fixed steps arrived. */
    begin(steps: number) {
      s.tick++
      s.stepped = steps > 0
    },
    take,
    /**
     * The tick brought `key` a record (`eachRecord`), `newest` and, when it kept it, `before`,
     * into the two states its drawer keeps for it (`state`; at rest it is drawn on the newest) by
     * `take`'s rule, a thing new under its key (`fresh`) starting from its first state. Returns
     * whether its states changed.
     */
    record(
      key: number,
      state: Readonly<States>,
      newest: Float32Array,
      before: Float32Array | null,
      fresh: boolean,
    ) {
      const same = !s.stepped && !fresh && sameValues(newest, state.to),
        from = take(key, before !== null, fresh, same)
      if (from === FROM.kept) return false
      if (from === FROM.before) state.from.set(before!)
      else state.from.set(from === FROM.newest || fresh ? newest : state.to)
      state.to.set(newest)
      return true
    },
    /** After a stepped tick, `land(key)` draws each listed key it did not bring on its newest
     *  state, and the key leaves the list. */
    end(land: (key: number) => void) {
      if (s.stepped) landKeys(s, land)
    },
    /** A frame at `t`: the keys `alive` says still are what they were drawn by `drawAll` in one
     *  pass — the rest leave the list —, then whether they are still on their way (and ask for the
     *  next frame), short of their newest or `waiting` for the next; else the list empties. */
    apply(
      t: number,
      waiting: boolean,
      alive: (key: number) => boolean,
      drawAll: (moving: Readonly<Int32Array>, count: number, t: number) => void,
    ) {
      if (!s.count) return false
      pruneKeys(s, alive)
      drawAll(s.moving, s.count, t)
      return settleKeys(s, t, waiting)
    },
  }
}

/** `draw(key, t)` as the pass over a list of keys that `apply` takes. */
export const drawEach =
  (draw: (key: number, t: number) => void) =>
  (moving: Readonly<Int32Array>, count: number, t: number) => {
    for (let i = 0; i < count; i++) draw(moving[i], t)
  }

/**
 * Each record of `records` (`../recordTick.ts`), `head` words then `count` items of `item` words:
 * `visit(id, newest, before, fields)`, its items as floats where its last step left them and,
 * when the tick kept it, a step before (else `null`), and its head words as floats.
 */
export function eachRecord(
  records: TickRecords,
  head: number,
  item: number,
  visit: (
    id: number,
    newest: Float32Array,
    before: Float32Array | null,
    fields: Float32Array,
  ) => void,
) {
  const { words, befores } = records
  const floats = new Float32Array(words.buffer, words.byteOffset, words.length),
    earlier = befores && new Float32Array(befores.buffer, befores.byteOffset, befores.length)
  for (let at = 0; at < words.length;) {
    const from = at + head,
      end = from + words[at + 1] * item,
      kept = earlier && keptBefore(words[at], befores![at])
    visit(
      words[at],
      floats.subarray(from, end),
      kept ? earlier.subarray(from, end) : null,
      floats.subarray(at, from),
    )
    at = end
  }
}
