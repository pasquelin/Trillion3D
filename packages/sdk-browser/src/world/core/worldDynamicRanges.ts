import type { DrawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts'
import { boxEmpty, boxExpandByPoint } from '../../../../sdk-core/src/math/primitives/box.ts'
import type { VertexRange } from '../../placement/engineSceneUpdates.ts'
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import type { Cut } from './worldCuts.ts'
import { markRewritten } from './rewrittenRanges.ts'

/** The lists of drawn triangles, the host attribute each is and its floats per vertex. */
export const LISTS = [
  ['positions', 'position', 3],
  ['normals', 'normal', 3],
  ['uvs', 'uv', 2],
  ['colors', 'color', 4],
] as const
const INDEX = { position: 0, normal: 1, uv: 2, color: 3 } as const

/** One range per list, `FIRST[n]` the first `n`, and the last `changedRanges`: made once. */
const RANGES: VertexRange[] = LISTS.map(([, name]) => ({ name, from: 0, count: 0 }))
const FIRST = [0, 1, 2, 3, 4].map((n) => RANGES.slice(0, n))
const changed = { ranges: FIRST[0], bytes: 0, box: new Float64Array(6) }

/** What `next` changed of `held`, list by list: the range from its first changed vertex to its
 *  last, the bytes of those lists, and the box of the moved vertices where they were and where
 *  they go. Nothing allocated: the answer is rewritten by the next call. */
export function changedRanges(held: DrawnTriangles, next: DrawnTriangles) {
  let n = 0
  changed.bytes = 0
  boxEmpty(changed.box, 0)
  for (const [field, name, width] of LISTS) {
    const a = held[field],
      b = next[field]
    if (!a || !b) continue
    let first = -1,
      last = -1
    for (let i = 0; i < a.length; i++)
      if (a[i] !== b[i]) {
        if (first < 0) first = i
        last = i
      }
    if (first < 0) continue
    const range = RANGES[n++]
    range.name = name
    range.from = Math.floor(first / width)
    range.count = Math.floor(last / width) + 1 - range.from
    changed.bytes += range.count * width * 4
    if (field === 'positions')
      for (let v = range.from * 3; v < (range.from + range.count) * 3; v += 3) {
        boxExpandByPoint(changed.box, 0, a[v], a[v + 1], a[v + 2])
        boxExpandByPoint(changed.box, 0, b[v], b[v + 1], b[v + 2])
      }
  }
  changed.ranges = FIRST[n]
  return changed
}

/** Writes `ranges` of `next` into `held`, in place: what the session reads next. */
export function copyRanges(held: DrawnTriangles, next: DrawnTriangles, ranges: VertexRange[]) {
  for (const { name, from, count } of ranges) {
    const [field, , width] = LISTS[INDEX[name]]
    held[field]!.set(next[field]!.subarray(from * width, (from + count) * width), from * width)
  }
}

type Attributes = Geometry['attributes']
type Session = {
  updateVertices(
    attributes: Attributes,
    ranges: VertexRange[],
    box: Float64Array,
    reach: number,
    boxes?: Float64Array,
  ): boolean
  vertexBytes?(attributes: Attributes, ranges: VertexRange[]): number | undefined
}
/** Where `upload` hands a resource's rewritten ranges, made once: `weigh` says the bytes
 *  they send the GPU, the session's count else the lists' own; `write` marks its host geometry and
 *  hands them, with the resource's `reach` and its pages' `boxes` (`pageMotion.ts`), to the
 *  session — false while none draws it, `refused` when it cannot take them; `renewed` says a
 *  session opened since. */
export const vertexUploads = (
  session: () => Session | null,
  geometryOf: (cut: Cut) => Geometry | undefined,
  refused: () => void,
) => {
  let told: object | null = null
  return {
    /** True once for each session opened since the last call: it holds roots
     *  that never heard the reach and boxes of the resources it was opened on, which their next
     *  `write` tells it. */
    renewed() {
      const open = session()
      if (!open || open === told) return false
      told = open
      return true
    },
    weigh(cut: Cut, ranges: VertexRange[], bytes: number) {
      const attributes = geometryOf(cut)?.attributes
      return (attributes && session()?.vertexBytes?.(attributes, ranges)) ?? bytes
    },
    write(cut: Cut, ranges: VertexRange[], box: Float64Array, reach: number, boxes?: Float64Array) {
      const geometry = geometryOf(cut),
        open = session()
      if (!geometry || !open) return false
      markRewritten(geometry, ranges)
      if (!open.updateVertices(geometry.attributes, ranges, box, reach, boxes)) refused()
      return true
    },
  }
}
export type VertexUploads = ReturnType<typeof vertexUploads>
