/**
 * A synthetic cluster DAG for the cut rule's tests: a strip of `leaves` unit-wide leaf clusters
 * along x, simplified level by level as a clustered DAG is — groups of four clusters, each
 * replaced by half as many outputs, the grouping shifted by two on every other level so a group
 * gathers the outputs of two different groups below. Every cluster knows the leaf units it covers
 * (`units`), so a test can check that a drawn set covers each leaf exactly once.
 *
 * Errors and spheres follow the compiler's convention: a group's error is above its members', its
 * outputs carry the group's error and sphere, and a group's sphere encloses its members' — the
 * projected error is then monotone up the DAG, as the cook guarantees.
 */
import { cullingLinks } from './links.ts'
import {
  CULL_CEIL,
  CULL_CHILD_COUNT,
  CULL_FIRST_CHILD,
  CULL_FIRST_PAGE,
  CULL_FLOOR,
  CULL_MAX,
  CULL_MIN,
  CULL_PAGE_COUNT,
  CULL_SPHERE,
  CULL_STRIDE,
} from '../dag/types.ts'
import { structureIndex } from '../selection/structure.ts'
import { IDENTITY_WORLD } from '../../session/host/matrixElements.ts'

export type RulePage = {
  url: string
  level: number
  lodError: number
  sphere: number[]
  parentError: number | null
  parentSphere: number[] | null
  group: number | null
  source: number | null
  min: number[]
  max: number[]
  triangles: number
  /** Leaf units `[first, end)` the cluster covers. */
  units: [number, number]
  /** Set by a test that loads the page, as a pool does: its residency without a host rule. */
  array?: Uint32Array
}

type Cluster = { units: [number, number]; error: number; sphere: number[]; source: number | null }
type Group = { members: number[]; outputs: number[]; error: number; sphere: number[] }

const sphereOf = ([a, b]: [number, number]) => [(a + b) / 2, 0, 0, (b - a) / 2 + 0.01]
/** The smallest sphere on the axis enclosing both. */
function enclose(s: number[], t: number[]) {
  const lo = Math.min(s[0] - s[3], t[0] - t[3]),
    hi = Math.max(s[0] + s[3], t[0] + t[3])
  return [(lo + hi) / 2, 0, 0, (hi - lo) / 2]
}

export function ruleDag(leaves = 64, leafError = 0.002) {
  const clusters: Cluster[] = [],
    groups: Group[] = []
  let level: number[] = []
  for (let u = 0; u < leaves; u++) {
    level.push(clusters.length)
    clusters.push({ units: [u, u + 1], error: 0, sphere: sphereOf([u, u + 1]), source: null })
  }
  const levelOf: number[] = level.map(() => 0)
  for (let depth = 0; level.length > 2; depth++) {
    const shift = depth % 2 ? 2 : 0,
      next: number[] = []
    for (let at = 0; at < level.length;) {
      const size = at === 0 && shift ? shift : Math.min(4, level.length - at)
      const members = level.slice(at, at + size)
      at += size
      const g = groups.length,
        first = clusters[members[0]].units[0],
        end = clusters[members[members.length - 1]].units[1]
      const sphere = members.map((m) => clusters[m].sphere).reduce(enclose)
      const error = leafError * 2 ** (depth + 1)
      const group: Group = { members, outputs: [], error, sphere }
      groups.push(group)
      const count = Math.max(1, members.length >> 1),
        span = (end - first) / count
      for (let o = 0; o < count; o++) {
        const units: [number, number] = [
          first + Math.round(o * span),
          o === count - 1 ? end : first + Math.round((o + 1) * span),
        ]
        group.outputs.push(clusters.length)
        next.push(clusters.length)
        levelOf.push(depth + 1)
        clusters.push({ units, error, sphere, source: g })
      }
    }
    level = next
  }
  const owner = new Map<number, number>()
  groups.forEach((g, id) => g.members.forEach((m) => owner.set(m, id)))
  // Coarsest first, as a compiled primitive packs them: the hierarchy groups each level.
  const order = clusters.map((_, i) => i).sort((a, b) => levelOf[b] - levelOf[a] || a - b)
  const rank = new Int32Array(clusters.length)
  order.forEach((c, r) => (rank[c] = r))
  const pages: RulePage[] = order.map((c) => {
    const cluster = clusters[c],
      g = owner.get(c),
      [a, b] = cluster.units
    return {
      url: `c${c}`,
      level: levelOf[c],
      lodError: cluster.error,
      sphere: cluster.sphere,
      parentError: g === undefined ? null : groups[g].error,
      parentSphere: g === undefined ? null : groups[g].sphere,
      group: g ?? null,
      source: cluster.source,
      min: [a, -0.25, -0.25],
      max: [b, 0.25, 0.25],
      triangles: 2 * (b - a),
      units: cluster.units,
    }
  })
  const structure = structureIndex(
    {
      version: 1,
      roots: level.map((c) => rank[c]),
      groups: groups.map((g) => ({
        level: 0,
        error: g.error,
        sphere: g.sphere,
        children: g.members.map((m) => rank[m]),
        outputs: g.outputs.map((o) => rank[o]),
      })),
    } as never,
    pages.length,
  )!
  const hierarchy = levelHierarchy(pages)
  const culling = { ...hierarchy, links: cullingLinks(hierarchy, pages.length) }
  return { pages, structure, culling, world: IDENTITY_WORLD, leaves }
}
export type RuleDag = ReturnType<typeof ruleDag>

/** What a coverage check reads of a DAG: the leaf units each page spans. */
export type UnitSpans = { leaves: number; pages: readonly { units: readonly number[] }[] }

/**
 * Whether `drawn` covers every leaf unit exactly once; returns the first unit covered zero times
 * or more than once, or -1.
 */
export function coverFault(dag: UnitSpans, drawn: Iterable<number>) {
  const hits = new Int32Array(dag.leaves)
  for (const page of drawn) {
    const [a, b] = dag.pages[page].units
    for (let u = a; u < b; u++) hits[u]++
  }
  return hits.findIndex((n) => n !== 1)
}

/**
 * A culling hierarchy shaped as the compiler's, each level its own subtree: one node per level
 * under the root, each over leaves of two neighbouring clusters, so a leaf near the eye is small
 * and top-down pruning bites.
 * Each node holds its clusters' box, the sphere enclosing their replacements' (their own for a
 * root) and the least of their own errors, as the compiler's node does. No replacement ceiling
 * (-1): only the floor prunes, which is what the rule's tests exercise.
 */
function levelHierarchy(pages: readonly RulePage[]) {
  const levels: Array<[number, number]> = []
  for (let i = 0; i < pages.length; i++)
    if (!i || pages[i].level !== pages[i - 1].level) levels.push([i, i])
    else levels[levels.length - 1][1] = i
  const leaves = levels.map(([a, b]) => Math.ceil((b - a + 1) / 2))
  const count = 1 + levels.length + leaves.reduce((n, l) => n + l, 0)
  const nodes = new Float64Array(count * CULL_STRIDE)
  const node = (at: number, first: number, pageCount: number) => {
    const base = at * CULL_STRIDE,
      held = pages.slice(first, first + pageCount)
    for (let a = 0; a < 3; a++) {
      nodes[base + CULL_MIN + a] = Math.min(...held.map((p) => p.min[a]))
      nodes[base + CULL_MAX + a] = Math.max(...held.map((p) => p.max[a]))
    }
    nodes.set(held.map((p) => p.parentSphere ?? p.sphere).reduce(enclose), base + CULL_SPHERE)
    nodes[base + CULL_CEIL] = -1
    nodes[base + CULL_FLOOR] = Math.min(...held.map((p) => p.lodError))
  }
  node(0, 0, pages.length)
  nodes[CULL_FIRST_CHILD] = 1
  nodes[CULL_CHILD_COUNT] = levels.length
  let next = 1 + levels.length
  levels.forEach(([a, b], k) => {
    const at = 1 + k
    node(at, a, b - a + 1)
    nodes[at * CULL_STRIDE + CULL_FIRST_CHILD] = next
    nodes[at * CULL_STRIDE + CULL_CHILD_COUNT] = leaves[k]
    for (let first = a; first <= b; first += 2, next++) {
      node(next, first, Math.min(2, b - first + 1))
      nodes[next * CULL_STRIDE + CULL_FIRST_PAGE] = first
      nodes[next * CULL_STRIDE + CULL_PAGE_COUNT] = Math.min(2, b - first + 1)
    }
  })
  return { nodes, stride: CULL_STRIDE }
}
