// The tree refit (`treeRefitWgsl.ts`, the shipped WGSL run in JavaScript) over a packing's tables:
// the one fit a test has of the placement tree, there being no other (`packPlacementTree` leaves
// every node open), over the leaves the GPU writes from the packing as it stands (`leafBoxes`). The tables are laid out as `layout` says — whole, or split
// into parts and ranges as a small device lays them.
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { refitLevels, REACH_UNBOUNDED, TREE_SPAN, type PlacementTree } from './placementTree.ts'
import { boxTransform } from '../../../../sdk-core/src/index.ts'
import { boxGrow } from '../../../../math/src/geometry/box.ts'
import { fromHalf } from '../../../../math/src/float/half.ts'
import { NODE_MAX, NODE_MIN } from './nodeLayout.ts'
import { SPRITE_UNCULLED } from '../../visibility/shader/spriteWgsl.ts'
import { mirrorKey } from '../../webgpu/cut/denseKeys.ts'
import { treeRefitWgsl, WHOLE_LAYOUT, type RefitLayout } from './treeRefitWgsl.ts'
import {
  DOUBLE_HELPERS,
  countLeadingZeros,
  pair,
  type Pair,
} from '../../placement/composeDoubles.fixture.ts'
import { DAG_NODE_FLOATS, FRAME_ROW_WORDS, type PackedDag } from './types.ts'

/** `words` as the parts of `per` records of `width` words each, the last taking the rest. */
function inParts(words: number[], per: number, parts: number, width: number) {
  return Array.from({ length: parts }, (_, p) =>
    words.slice(p * per * width, parts - 1 === p ? undefined : (p + 1) * per * width),
  )
}

/** Each placement's frame words the refit reads: its root, its mark. */
export const frameWords = (dag: PackedDag) =>
  Array.from({ length: dag.worldSources.length * FRAME_ROW_WORDS }, (_, k) => {
    const w = Math.floor(k / FRAME_ROW_WORDS),
      at = k % FRAME_ROW_WORDS
    return at === 1 ? dag.rootNodes[w] : at === 3 ? dag.mark[w] : 0
  })

/** Every placement's leaf as the GPU writes it (`../../placement/treeLeavesWgsl.ts`, proven word
 *  for word in `treeLeavesWgsl.test.ts`): its root node's box grown by its reach, carried by its
 *  world, six numbers each; a parked placement's none (zeros): the refit passes over it. */
export function leafBoxes(dag: PackedDag) {
  const count = dag.worldSources.length,
    leaves = new Float64Array(count * 6),
    box = new Float64Array(12)
  for (let w = 0; w < count; w++) {
    if (dag.rootNodes[w] === NONE) continue
    const at = dag.rootBases[w] * DAG_NODE_FLOATS
    for (let a = 0; a < 3; a++) {
      box[a] = dag.nodes[at + NODE_MIN + a]
      box[3 + a] = dag.nodes[at + NODE_MAX + a]
    }
    const bits = dag.mark[w] >>> 16
    boxGrow(box, 6, box, 0, bits && bits < REACH_UNBOUNDED ? fromHalf(bits) : 0)
    boxTransform(leaves, w * 6, box, 6, dag.worldSources[w].world.elements)
  }
  return leaves
}

/** Fits `groups` of `dag`'s tree and every node above them, in `dag.nodes`; every group by default.
 *  The leaves are the GPU's from the packing as it stands (`leafBoxes`), the marks and parks the
 *  packing's. Returns the nodes fitted. */
export function refitTree(
  dag: PackedDag,
  groups?: Iterable<number>,
  layout: RefitLayout = WHOLE_LAYOUT,
) {
  const tree = dag.placementTree as PlacementTree
  const count = dag.worldSources.length
  const words = new Uint32Array(dag.nodes.buffer, dag.nodes.byteOffset, dag.nodes.length)
  const members = Array.from(leafBoxes(dag), (v) => pair(v) as Pair),
    frames = frameWords(dag)
  const cold: number[] = []
  for (let k = 0; k < tree.capacity; k++) cold[tree.members + k] = tree.order[k]
  const nodeParts = inParts(
    Array.from(words),
    layout.nodes.per,
    layout.nodes.parts,
    DAG_NODE_FLOATS,
  )
  const coldParts = inParts(cold, layout.cold.per, layout.cold.parts, 1)
  const tables: Record<string, unknown> = {}
  nodeParts.forEach((part, k) => (tables[k ? `nodes${k}` : 'nodes'] = part))
  coldParts.forEach((part, k) => (tables[k ? `cold${k}` : 'cold'] = part))
  layout.frames.forEach(
    (first, r) =>
      (tables[`frames${r}`] = frames.slice(
        first * FRAME_ROW_WORDS,
        (layout.frames[r + 1] ?? count) * FRAME_ROW_WORDS,
      )),
  )
  const params = { first: 0, count: 0, base: 0, live: tree.count, members: tree.members } as Record<
    string,
    number
  >
  const run = shaderRun<{ fitGroup(j: number): void; fitCell(j: number): void }>(
    treeRefitWgsl(layout),
    [
      ...DOUBLE_HELPERS,
      ...['dLess', 'dMin', 'dMax', 'dAbs', 'toF32', 'fromF32'],
      ...['nodeWord', 'setNodeWord', 'coldAt', 'frameWord', 'writeBox', 'fitGroup', 'fitCell'],
    ],
    {
      countLeadingZeros,
      params,
      ...tables,
      members,
    },
  )
  const all = groups ?? Array.from({ length: tree.levels.at(-1)!.count }, (_, g) => g)
  let fitted = 0
  for (const { level, ids } of refitLevels(tree, all)) {
    const below = tree.levels[level + 1]
    Object.assign(params, {
      base: tree.levels[level].base,
      childBase: below?.base ?? 0,
      childCount: below?.count ?? 0,
    })
    for (const j of ids) {
      if (below) run.fitCell(j)
      else run.fitGroup(j)
      fitted++
    }
  }
  words.set(nodeParts.flat())
  return fitted
}

/** No node: a parked root's. */
const NONE = 0xffffffff

/** The change the refit proofs fit again, on `dag` packed from `roots`: poses a long way off, a
 *  park, a mark drawn whatever the view, a reach, a whole group parked. Returns the placements it touched. */
export function treeChange(dag: PackedDag, roots: readonly { world: { elements: unknown } }[]) {
  const tree = dag.placementTree!,
    touched = new Set<number>()
  const move = (w: number, x: number) => {
    ;(roots[w].world.elements as Float64Array)[12] += x
    touched.add(w)
  }
  for (const [w, x] of [
    [3, 4000],
    [70, -900],
    [4000, 50],
    [4001, 51],
    [9999, 1e5],
  ])
    move(w, x)
  dag.rootNodes[130] = NONE
  dag.mark[200] = SPRITE_UNCULLED
  mirrorKey(tree.always, 200, true)
  // A reach grows the leaf the GPU writes again.
  dag.mark[7000] = 5 << 16
  for (let k = 0; k < TREE_SPAN; k++) dag.rootNodes[tree.order[640 + k]] = NONE
  for (const w of [130, 200, 7000, tree.order[640]]) touched.add(w)
  return touched
}
