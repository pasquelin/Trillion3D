/**
 * WHETHER THE WORLD CAN STAND IN FOR AN OBJECT: EVERY ROOT ABOVE IT READY.
 *
 * The world draws a placed object's surface in its place only through the clusters its cut reaches
 * from the roots of the world above the object — the clusters nothing replaces, reached from the
 * object's world cluster through the groups replacing it (`worldLinks.ts`, `worldCovers`). The
 * pinned top is always ready; a root its cell's hold asks for — a lone object's copies, a cell's
 * super-root no top continued — arrives after the placement may: until every root above is ready,
 * the world's stand-in has a hole, and the placement draws itself.
 *
 * Objects share their roots: each distinct set is one flag word, raised while every root of the
 * set is ready. The packing writes per world cluster the distance from its word to its set's flag
 * (`standInWords`); the residency upload lowers and raises the flags as the roots' readiness moves
 * (`createStandInFlags`), a set's count of roots not ready kept on the host. The gate reads two
 * words for an object whose group is not ready, whatever the roots above it number.
 *
 * Cost: at packing, each group's set once — `Σ_g |roots(g)|`, read once; a frame, `k` per root whose
 * readiness moved, `k` the sets holding it, and one write per run of flags that moved.
 */
import type { DagCutLinks } from './types.ts'
import type { RangeTarget } from './runWrites.ts'
import { writeRanges } from './runWrites.ts'
import { createChangedRuns } from '../../webgpu/residency/ranges.ts'

/** The world's sets of roots: per set its packed pages (`rootsOf` from `offsets`), per root page the
 *  sets that hold it. */
export type StandInSets = {
  offsets: Int32Array
  roots: Int32Array
  setsOf: Map<number, number[]>
}

/**
 * The stand-in words of the world DAG `links`, whose `origins` name the objects: one per cluster —
 * for an object, the distance from it to its set's flag, 0 for another cluster —, then one flag per
 * set, down until the residency raises it; and the sets.
 */
export function standInWords({ structure, pageBase, pageCount }: DagCutLinks, origins: Int32Array) {
  const sets = new Map<string, number>(),
    above = new Map<number, number[]>(),
    offsets = [0],
    roots: number[] = []
  const rootsOfGroup = (g: number): number[] => {
    let found = above.get(g)
    if (found) return found
    const s = structure!,
      union = new Set<number>()
    for (let i = s.outputOffsets[g]; i < s.outputOffsets[g + 1]; i++) {
      const output = s.outputs[i],
        owner = s.owners[output]
      if (owner < 0) union.add(output)
      else for (const root of rootsOfGroup(owner)) union.add(root)
    }
    above.set(g, (found = [...union].sort((a, b) => a - b)))
    return found
  }
  const setOf = new Int32Array(pageCount).fill(-1)
  origins.forEach((origin, rank) => {
    if (origin < 0) return
    const owner = structure ? structure.owners[rank] : -1
    const found = owner < 0 ? [rank] : rootsOfGroup(owner),
      key = found.join()
    let set = sets.get(key)
    if (set === undefined) {
      sets.set(key, (set = offsets.length - 1))
      for (const root of found) roots.push(pageBase + root)
      offsets.push(roots.length)
    }
    setOf[rank] = set
  })
  const words = new Uint32Array(pageCount + sets.size)
  setOf.forEach((set, rank) => set >= 0 && (words[rank] = pageCount + set - rank))
  const setsOf = new Map<number, number[]>()
  for (let set = 0; set + 1 < offsets.length; set++)
    for (let i = offsets[set]; i < offsets[set + 1]; i++) {
      const held = setsOf.get(roots[i])
      if (held) held.push(set)
      else setsOf.set(roots[i], [set])
    }
  const standIns: StandInSets = {
    offsets: Int32Array.from(offsets),
    roots: Int32Array.from(roots),
    setsOf,
  }
  return { words, standIns }
}

/**
 * The flags of `sets`, at word `base` of the cold table — `host` its copy, `cold` its writer —,
 * kept to the roots' readiness: `ready(page, value)` for a page whose readiness may have moved,
 * `flush` sends the flags that moved. Made with nothing ready: every flag down, written whole.
 */
export function createStandInFlags(
  sets: StandInSets,
  base: number,
  host: Uint32Array,
  cold: RangeTarget,
) {
  const count = sets.offsets.length - 1,
    missing = Int32Array.from({ length: count }, (_, s) => sets.offsets[s + 1] - sets.offsets[s]),
    ready = new Set<number>(),
    moved = createChangedRuns(),
    source = { data: host, sourceBase: base, targetBase: base, stride: 1 }
  host.fill(0, base, base + count)
  if (count) cold(base * 4, host.buffer as ArrayBuffer, host.byteOffset + base * 4, count * 4)
  return {
    ready(page: number, value: boolean) {
      const held = sets.setsOf.get(page)
      if (!held || ready.has(page) === value) return
      if (value) ready.add(page)
      else ready.delete(page)
      for (const set of held) {
        missing[set] += value ? -1 : 1
        const flag = missing[set] === 0 ? 1 : 0
        if (host[base + set] === flag) continue
        host[base + set] = flag
        moved.mark(set)
      }
    },
    flush() {
      if (!moved.count) return
      const sorted = moved.take()
      writeRanges(cold, sorted, sorted.length, source)
    },
  }
}
