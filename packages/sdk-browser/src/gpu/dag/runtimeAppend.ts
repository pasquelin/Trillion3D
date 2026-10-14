// Roots appended into a camera cut's room (`runtime.ts`): packed behind the others, their words
// sent, their stretch the root boxes pass's (`../../placement/rootWorlds.ts`).
import { writePrimitiveWords } from './worlds.ts'
import type { DagResources } from './resources.ts'
import { appendDagRoots, type DagAppended } from './packAppend.ts'
import { writeRanges, type RangeTarget } from './runWrites.ts'
import {
  COLD_WORDS,
  CLUSTER_WORDS,
  groupParentBase,
  keyGroupBase,
  keyWordBase,
  recordKeyBase,
} from './layout.ts'
import { DAG_NODE_FLOATS, type DagRoot } from './types.ts'
import { voidCuts, type DagRun } from './runtimeOps.ts'

/** `GpuSelection.appendRoots`: roots packed behind the others, their words sent. */
export function appendRoots(run: DagRun, roots: readonly DagRoot[]) {
  const { resources, state, uploadResidency, tree } = run
  if (state.disposed || state.dead || state.growing) return false
  const added = appendDagRoots(resources.packed, roots)
  if (!added) return false
  // Their nodes' open counts first: the node words go up once, with them.
  uploadResidency.append()
  writeAppended(resources, added)
  // Their groups are fitted at the next cut, over the leaves of the placements they hold.
  const [first, end] = added.worlds
  for (let w = first; w < end; w++) tree?.touch(w)
  run.proxies.appended(first, end)
  run.proxies.worldsRange(first, end)
  voidCuts(state)
  return true
}

/** What `appendDagRoots` wrote, sent: the appended placements' primitive words, frame rows, worlds
 *  and origins, and the placement tree's nodes and member words they joined. Nothing else of the
 *  tables moved: their nodes, records and content keys are their primitives', already there. */
function writeAppended(resources: DagResources, added: DagAppended) {
  const { packed, cutTables, cold, frames, frameData, treeTable } = resources,
    cones = packed.pageCones
  const send = (target: RangeTarget, source: Float32Array, from: number, bytes: number) =>
    bytes > 0 && target(from, source.buffer as ArrayBuffer, source.byteOffset + from, bytes)
  const [w0, w1] = added.worlds
  // The primitives it brought: their nodes, hot and cold records, the keys their records read by
  // and the key words they named or moved — written once, as a packing of every root wrote them.
  const [n0, n1] = added.nodes,
    [r0, r1] = added.records,
    nodeBytes = DAG_NODE_FLOATS * 4
  send(cutTables.nodes.target('Node'), packed.nodes, n0 * nodeBytes, (n1 - n0) * nodeBytes)
  const clusters = cutTables.clusters.target('Cluster')
  send(clusters, packed.clusters, r0 * CLUSTER_WORDS * 4, (r1 - r0) * CLUSTER_WORDS * 4)
  const coldAt = packed.shared!.coldAt!
  send(cold, cones, (coldAt + r0 * COLD_WORDS) * 4, (r1 - r0) * COLD_WORDS * 4)
  send(cold, cones, (recordKeyBase(packed.pageCount) + r0) * 4, (r1 - r0) * 4)
  // The keys' words and groups, each table's in the cut's one run writer's ranges.
  if (added.keys.length) {
    const keys = Int32Array.from(new Set(added.keys)).sort(),
      words = new Uint32Array(cones.buffer, cones.byteOffset, cones.length)
    for (const base of [keyWordBase(packed), keyGroupBase(packed)])
      writeRanges(cold, keys, keys.length, {
        data: words,
        sourceBase: base,
        targetBase: base,
        stride: 1,
      })
  }
  // The key groups they made: the parent starts of each, and the edges behind the live ones.
  const parentAt = groupParentBase(packed),
    [g0, g1] = added.groups,
    [e0, e1] = added.edges
  send(cold, cones, (parentAt + g0 + 1) * 4, (g1 - g0) * 4)
  send(cold, cones, (parentAt + packed.groupCount + 1 + e0) * 4, (e1 - e0) * 4)
  // The tree nodes joined, in the run writer's ranges, and the member slots they took.
  treeTable.writeNodes(added.tree.nodes)
  treeTable.writeMembers(...added.tree.members)
  for (let w = w0; w < w1; w++) writePrimitiveWords(frameData, packed, w)
  frames.writeRows(w0, w1)
  // The appended placements' worlds, one range, and their exact translations, they alone.
  frames.writeWorlds(packed.worlds, w0, w1)
  const appended = new Int32Array(w1 - w0)
  for (let k = 0; k < appended.length; k++) appended[k] = w0 + k
  frames.writeWorldOrigins(appended)
}
