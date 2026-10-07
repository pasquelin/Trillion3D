import type { PageCutPayload } from '../../../../sdk-core/src/page/taskContracts.ts'
import { BOX_VALUES } from '../../../../sdk-core/src/math/primitives/box.ts'
import type { VertexRange } from '../../placement/engineSceneUpdates.ts'

/**
 * WHERE EACH PAGE OF A DYNAMIC CUT HAS ITS VERTICES, measured page by page as they are
 * rewritten: the box of its own vertices (`boxes`, local, `BOX_VALUES` a page) and how far the farthest of them lies on
 * an axis from where `rest` put it — the reach, whose most over the pages its roots' cuts grow
 * their rest bounds by. Every bound a page's row carries — its shadow sphere, its occlusion
 * corners — is that box (`PageRec.moved`): a sea's page is bounded where its own vertices are this
 * frame, not by its rest box grown on every side by the swell of the whole sea. Made once a cut;
 * a measure allocates nothing.
 */
export function createPageMotion(cut: PageCutPayload, rest: Float32Array) {
  const count = cut.pages.length,
    seen = new Int32Array(rest.length / 3).fill(-1),
    // Page k's vertices, each once, are `vertices[first[k] .. first[k + 1])`: `low[k]` and
    // `high[k]` the least and greatest of them, what a rewritten range is tested against.
    first = new Uint32Array(count + 1),
    low = new Uint32Array(count).fill(0xffffffff),
    high = new Uint32Array(count),
    own: number[] = []
  for (let k = 0; k < count; k++) {
    for (const v of new Uint32Array(cut.pages[k].index)) {
      if (seen[v] === k) continue
      seen[v] = k
      own.push(v)
      low[k] = Math.min(low[k], v)
      high[k] = Math.max(high[k], v)
    }
    first[k + 1] = own.length
  }
  const vertices = Uint32Array.from(own)
  const boxes = new Float64Array(count * BOX_VALUES),
    reaches = new Float64Array(count)
  /** Page `k`'s box and reach at `p`. */
  const measurePage = (k: number, p: ArrayLike<number>) => {
    let x0 = Infinity,
      y0 = Infinity,
      z0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity,
      z1 = -Infinity,
      reach = 0
    // Branchless: a vertex's place in its page's box is no pattern a branch predicts.
    for (let i = first[k], end = first[k + 1]; i < end; i++) {
      const v = vertices[i] * 3,
        x = p[v],
        y = p[v + 1],
        z = p[v + 2]
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
      z0 = Math.min(z0, z)
      z1 = Math.max(z1, z)
      reach = Math.max(reach, Math.abs(x - rest[v]))
      reach = Math.max(reach, Math.abs(y - rest[v + 1]))
      reach = Math.max(reach, Math.abs(z - rest[v + 2]))
    }
    const b = k * BOX_VALUES
    reaches[k] = reach
    boxes[b] = x0
    boxes[b + 1] = y0
    boxes[b + 2] = z0
    boxes[b + 3] = x1
    boxes[b + 4] = y1
    boxes[b + 5] = z1
  }
  for (let k = 0; k < count; k++) measurePage(k, rest)
  return {
    /** Each page's box where its vertices were last measured: its rest box until they move. */
    boxes,
    /**
     * Measures again each page holding a vertex of `ranges`' positions, at `positions` — the lists
     * the session draws next —, and returns the farthest any page's vertex lies from rest.
     */
    measure(positions: ArrayLike<number>, ranges: readonly VertexRange[]) {
      for (const { name, from, count: n } of ranges) {
        if (name !== 'position') continue
        for (let k = 0; k < count; k++)
          if (low[k] < from + n && high[k] >= from) measurePage(k, positions)
      }
      let reach = 0
      for (let k = 0; k < count; k++) reach = Math.max(reach, reaches[k])
      return reach
    },
  }
}
export type PageMotion = ReturnType<typeof createPageMotion>
