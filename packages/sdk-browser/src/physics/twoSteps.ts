import { sameValues } from '../math/matrixElements.ts';
import { keptBefore, type TickRecords } from './protocol.ts';

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
} as const;

/** A drawn thing's two states (`createTwoSteps`): a step before its newest, and its newest. */
type States = { from: Float32Array | Float64Array; to: Float32Array | Float64Array };

/**
 * THE TWO STEPS EVERYTHING THE PHYSICS DRAWS IS DRAWN BETWEEN: a body's pose (`poses.ts`), a
 * vehicle's wheels (`vehicles.ts`), a soft body's vertices (`softBodies.ts`), the character's feet
 * (`physicsCharacter.ts`). Each is kept, under a key below `capacity`, as its state at the newest
 * step a tick brought and its state a step before (`FROM`), in its drawer's own store; every frame
 * draws all of them at the one fraction `t` of that step the frame's time stands at (`along`,
 * read once by the session), past 1 moved on from the newest while the page waits for the next.
 * This keeps which keys are on their way and where their earlier state comes from. A key a
 * stepped tick says nothing of stands where its last step left it: drawn there (`end`), it leaves
 * the list; once the time drawn is past every newest and nothing is awaited, the list empties.
 */
export function createTwoSteps(capacity: number) {
  const listed = new Uint8Array(capacity),
    stamp = new Uint32Array(capacity),
    moving = new Int32Array(capacity);
  let count = 0,
    tick = 0,
    stepped = false;
  /**
   * The tick brought `key`: `before` when it kept its state a step before, `fresh` when it is
   * another thing than the one listed under it, `same` when its newest is the one it already
   * holds. Returns where its earlier state comes from; listed but `FROM.kept`.
   */
  const take = (key: number, before: boolean, fresh: boolean, same: boolean) => {
    if (!stepped && same) return FROM.kept;
    const from = !stepped
      ? FROM.newest
      : before
        ? FROM.before
        : listed[key] && !fresh
          ? FROM.last
          : FROM.drawn;
    stamp[key] = tick;
    if (!listed[key]) moving[count++] = key;
    listed[key] = 1;
    return from;
  };
  return {
    /** The listed keys, `count` of them. */
    moving: moving as Readonly<Int32Array>,
    get count() {
      return count;
    },
    /** Whether `key` is on its way. */
    listed: (key: number) => listed[key] === 1,
    /** A tick of `steps` fixed steps arrived. */
    begin(steps: number) {
      tick++;
      stepped = steps > 0;
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
      const same = !stepped && !fresh && sameValues(newest, state.to),
        from = take(key, before !== null, fresh, same);
      if (from === FROM.kept) return false;
      if (from === FROM.before) state.from.set(before!);
      else state.from.set(from === FROM.newest || fresh ? newest : state.to);
      state.to.set(newest);
      return true;
    },
    /** After a stepped tick, `land(key)` draws each listed key it did not bring on its newest
     *  state, and the key leaves the list. */
    end(land: (key: number) => void) {
      if (!stepped) return;
      let kept = 0;
      for (let i = 0; i < count; i++) {
        const key = moving[i];
        if (stamp[key] === tick) moving[kept++] = key;
        else {
          land(key);
          listed[key] = 0;
        }
      }
      count = kept;
    },
    /** Keeps listed the keys `alive` says still are what they were; the rest leave. */
    keep(alive: (key: number) => boolean) {
      let kept = 0;
      for (let i = 0; i < count; i++) {
        const key = moving[i];
        if (alive(key)) moving[kept++] = key;
        else listed[key] = 0;
      }
      count = kept;
    },
    /** After a frame drew the list at `t`: whether its keys are still on their way (and ask for
     *  the next frame), short of their newest or `waiting` for the next; else the list empties. */
    settle(t: number, waiting: boolean) {
      if (t < 1 || waiting) return count > 0;
      for (let i = 0; i < count; i++) listed[moving[i]] = 0;
      count = 0;
      return false;
    },
  };
}

/**
 * Each record of `records` (`recordTick.ts`), `head` words then `count` items of `item` words:
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
  const { words, befores } = records;
  const floats = new Float32Array(words.buffer, words.byteOffset, words.length),
    earlier = befores && new Float32Array(befores.buffer, befores.byteOffset, befores.length);
  for (let at = 0; at < words.length;) {
    const from = at + head,
      end = from + words[at + 1] * item,
      kept = earlier && keptBefore(words[at], befores![at]);
    visit(
      words[at],
      floats.subarray(from, end),
      kept ? earlier.subarray(from, end) : null,
      floats.subarray(at, from),
    );
    at = end;
  }
}

/** `out`, `t` of the way from `from` to `to` (`along`): on their line, past `to` beyond 1. */
export function lerpInto(
  out: Float32Array | Float64Array,
  from: ArrayLike<number>,
  to: ArrayLike<number>,
  t: number,
) {
  if (t === 1) for (let i = 0; i < out.length; i++) out[i] = to[i];
  else for (let i = 0; i < out.length; i++) out[i] = from[i] + (to[i] - from[i]) * t;
}
