/**
 * WHAT A FRAME'S PLAN KEEPS, AND ONLY THAT: each entry lives while every frame touches it again
 * (`touch`, or `set` a new key), and the frame's `end` lets go of those it did not touch — `left` hears each —.
 * The one rule by which the view's asks (`../../scene/drive/viewAsks.ts`) and the partition's decodes
 * (`../partition/decodes.ts`) cancel what left the plan, and nothing else.
 *
 * Cost: O(1) a touch, O(n) an `end` for the n entries held; nothing is allocated past them.
 */
export function createFrameKept<Key, Value>(left: (value: Value) => void = () => {}) {
  const kept = new Map<Key, { value: Value; frame: number }>()
  let frame = 0
  return {
    /** `key`'s value, kept by the frame under way. */
    touch(key: Key) {
      const own = kept.get(key)
      if (!own) return undefined
      own.frame = frame
      return own.value
    },
    /** `key`'s value, the frame's mark left as it stands: what a landing reads between frames. */
    peek: (key: Key) => kept.get(key)?.value,
    /** `key` holds `value`: a new key kept by the frame under way, a held one by the frame that
     *  last touched it — a landing between frames keeps nothing the plan let go. A value it
     *  replaces is not told. */
    set(key: Key, value: Value) {
      const own = kept.get(key)
      if (own) own.value = value
      else kept.set(key, { value, frame })
    },
    /** `key` was taken: it is let go without being told. */
    delete: (key: Key) => void kept.delete(key),
    /** The frame is over: what it did not touch is let go. */
    end() {
      for (const [key, own] of kept)
        if (own.frame !== frame) {
          kept.delete(key)
          left(own.value)
        }
      frame++
    },
    /** Every entry let go: the plan holds nothing any more. */
    clear() {
      for (const own of kept.values()) left(own.value)
      kept.clear()
    },
  }
}
