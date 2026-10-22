import type { BounceCascades } from '../../../../sdk-core/src/bounce/cascades.ts'
import type { ReadbackRing } from '../../gpu/core/readbackRing.ts'

/** What a bitmap of marks in flight remembers: the image it was made in and the lowest cell of each
 *  level then, the window its bits name their cells in (`applyMarks`). */
export type MarkTag = { frame: number; bases: Int32Array }

/**
 * The tags of the bitmaps in flight, handed out in turn: one more than the ring holds buffers, so
 * that a tag a read still holds is never filled again. `take` gives image `frame` a staging buffer
 * of `ring`, none while all are in flight, tagged with the levels' windows as they stand.
 */
export function createMarkTags(cascades: BounceCascades, inFlight: number) {
  const levels = cascades.levels.length
  const tags: MarkTag[] = Array.from({ length: inFlight + 1 }, () => ({
    frame: 0,
    bases: new Int32Array(levels * 3),
  }))
  let next = 0
  return {
    take(ring: ReadbackRing<MarkTag>, bytes: number, frame: number) {
      const tag = tags[next]
      const buffer = ring.take(tag, bytes)
      if (!buffer) return undefined
      next = (next + 1) % tags.length
      tag.frame = frame
      for (let level = 0; level < levels; level++)
        for (let axis = 0; axis < 3; axis++)
          tag.bases[level * 3 + axis] = cascades.levels[level].base[axis]
      return buffer
    },
  }
}
