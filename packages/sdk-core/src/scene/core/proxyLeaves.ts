import { PROXY_CHILD_WORDS } from '../../contracts/proxy.ts'

/** Leaf child word bit: the leaf's triangles are canonical and traced under their owners' poses. */
export const PROXY_LEAF_OWNED = 1 << 25
/** Triangle group word bit: the same state, for a pass that walks triangles, not the tree. */
export const PROXY_GROUP_OWNED = 0x80000000
const PRESENT = 1 << 24

/** Dirty range of a column, in its own units, taken once per upload. */
function createSpan() {
  let first = Infinity,
    end = 0
  return {
    add(from: number, to: number) {
      first = Math.min(first, from)
      end = Math.max(end, to)
    },
    take(): [number, number] | undefined {
      const span: [number, number] | undefined = end > first ? [first, end] : undefined
      first = Infinity
      end = 0
      return span
    },
  }
}

/**
 * Each leaf of the wide tree is either posed — its triangles written at their owners' common pose,
 * traced as they are — or owned — canonical, traced under each owner's pose. The state is one bit
 * of the leaf's child word, so a ray over a posed leaf reads no owner word, mirrored in each
 * triangle's group word for the surface cache, which walks triangles. The session owns the
 * presence byte of its copy of the tree: presence is the one bit the compiler writes.
 */
export function createProxyLeaves(
  children: Uint32Array,
  groups: Uint32Array,
  triangles: Float32Array,
  canonical: Float32Array,
) {
  const words: number[] = [],
    firsts: number[] = [],
    ends: number[] = []
  const leafOf = new Uint32Array(groups.length).fill(0xffffffff)
  for (let at = 1; at < children.length; at += PROXY_CHILD_WORDS) {
    if (children[at] >>> 24 === 0) continue
    children[at] = ((children[at] & 0xffffff) | PRESENT) >>> 0
    const count = (children[at] >>> 16) & 255,
      first = children[at + 1]
    if (!count) continue
    for (let t = first; t < first + count; t++) leafOf[t] = words.length
    words.push(at)
    firsts.push(first)
    ends.push(first + count)
  }
  const owned = new Uint8Array(words.length),
    posedOnce = new Uint8Array(words.length)
  const triangleSpan = createSpan(),
    groupSpan = createSpan(),
    wordSpan = createSpan()
  let ownedCount = 0
  const flag = (leaf: number, on: boolean) => {
    ownedCount += on ? 1 : -1
    owned[leaf] = on ? 1 : 0
    const at = words[leaf]
    children[at] = (on ? children[at] | PROXY_LEAF_OWNED : children[at] & ~PROXY_LEAF_OWNED) >>> 0
    for (let t = firsts[leaf]; t < ends[leaf]; t++)
      groups[t] = (on ? groups[t] | PROXY_GROUP_OWNED : groups[t] & ~PROXY_GROUP_OWNED) >>> 0
    wordSpan.add(at, at + 1)
    groupSpan.add(firsts[leaf], ends[leaf])
  }
  return {
    count: words.length,
    /** Typed storage: the leaf of each triangle and the two leaf states. */
    bytes: leafOf.byteLength + owned.byteLength * 2,
    leafOf,
    owned,
    firsts,
    ends,
    get ownedCount() {
      return ownedCount
    },
    /** Hands the leaf to its owners' poses; a leaf never posed away from bind is canonical already. */
    own(leaf: number) {
      if (posedOnce[leaf]) {
        const from = firsts[leaf] * 9
        triangles.set(canonical.subarray(from, ends[leaf] * 9), from)
        triangleSpan.add(firsts[leaf], ends[leaf])
      }
      flag(leaf, true)
    },
    /** Written at the common pose by `write`; rays then read no owner word for it. */
    pose(leaf: number, write: (triangle: number) => void) {
      for (let t = firsts[leaf]; t < ends[leaf]; t++) write(t)
      triangleSpan.add(firsts[leaf], ends[leaf])
      posedOnce[leaf] = 1
      flag(leaf, false)
    },
    /** What changed since the last call, as ranges: triangles written, group words, child words. */
    take() {
      return {
        triangles: triangleSpan.take(),
        groups: groupSpan.take(),
        childWords: wordSpan.take(),
      }
    },
  }
}
