// The double runs the transparent compaction at the workgroups the host dispatched, as a device
// does: a host that dispatches too few leaves groups uncounted here too, where the double once ran
// one thread for each the uniform counted whatever the dispatch. Its cut likewise marks a blended
// cluster only where the visible list had room, and descends the levels the cut dispatches.
import test from 'node:test'
import assert from 'node:assert/strict'
import { descentLevels, simulateComputeDispatch, writeVisibleList } from './fakeCompute.ts'
import type { PackedDag } from '../../../packages/sdk-browser/src/geometry/dag/types.ts'
import { CLUSTER_WORDS, HOT_FLAGS } from '../../../packages/sdk-browser/src/geometry/dag/layout.ts'
import { CLUSTER_TRANSPARENT } from '../../../packages/sdk-browser/src/geometry/dag/clusterFlags.ts'
import { VISIBLE_RECORD_WORDS } from '../../../packages/sdk-browser/src/geometry/dag/visible/layout.ts'
import { VISIBLE_HEADER_WORDS } from '../../../packages/sdk-browser/src/geometry/dag/visible/layout.fixture.ts'
import { indexOfRanks } from '../../../packages/sdk-browser/src/geometry/selection/placements.fixture.ts'

const GROUPS = 100
/** Sitting in every group count before the pass: a count it did not write. */
const UNWRITTEN = 7

/** The compaction's group with `groupCount` groups of no entry, every count unwritten. */
function compaction() {
  const buffers = Array.from({ length: 9 }, () => new Uint32Array(1))
  buffers[1] = Uint32Array.of(0, GROUPS, 0, 0, 0, 0, 0, 0)
  buffers[3] = new Uint32Array(GROUPS).fill(UNWRITTEN)
  return {
    counts: buffers[3],
    bind: {
      entries: buffers.map((data, binding) => ({
        binding,
        resource: { buffer: { data: new Uint8Array(data.buffer) } },
      })),
    },
  }
}

test('the compaction counts the groups its dispatch reaches, and those alone', () => {
  // A workgroup a group: its lanes count the group's entries by the lane scan (`shader.ts`).
  const pipeline = { entryPoint: 'countTransparentGroups' }
  const reached = GROUPS / 2
  const short = compaction()
  simulateComputeDispatch(pipeline, short.bind, undefined, undefined, reached)
  assert.deepEqual([...short.counts.subarray(0, reached)], new Array(reached).fill(0))
  assert.deepEqual([...short.counts.subarray(reached)], new Array(GROUPS - reached).fill(UNWRITTEN))
  const whole = compaction()
  simulateComputeDispatch(pipeline, whole.bind, undefined, undefined, GROUPS)
  assert.deepEqual([...whole.counts], new Array(GROUPS).fill(0))
})

// A blended cluster takes its bit in the blend pass's mask where the list of visible clusters had
// room for it (`drawCluster`, `visibleAppend`): one it had none for is not drawn, and has none.
test('the double marks a blended cluster only where the visible list had room for it', () => {
  const pages = 3,
    cap = 2
  // Three clusters of one placement, all blended.
  const clusters = new Float32Array(pages * CLUSTER_WORDS)
  const ints = new Uint32Array(clusters.buffer)
  for (let page = 0; page < pages; page++)
    ints[page * CLUSTER_WORDS + HOT_FLAGS] = CLUSTER_TRANSPARENT
  const dag = {
    ...{ clusters, coldWords: new Float32Array(1), pageCount: pages },
    ...{ recordShift: new Uint32Array(1), rootBases: new Uint32Array(1) },
    pageIndex: indexOfRanks([0, 0, 0], 1),
  } as unknown as PackedDag
  const visible = new Uint32Array(VISIBLE_HEADER_WORDS + VISIBLE_RECORD_WORDS * cap)
  const mask = new Uint32Array(1)
  writeVisibleList(visible, cap, dag, [0, 1, 2], mask)
  assert.equal(mask[0], 0b011, 'the third found no room in the list: no bit')
})

// The double's descent reads the levels the cut dispatches and no more: a packing's level count, held
// to the deepest level a resident page needs (`residentLevels`), or every level of a DAG that counts
// none (the bindings').
test('the double’s descent reads the levels the cut dispatches', () => {
  const dag = (sizes: number[], resident?: number) =>
    ({
      levelSizes: Uint32Array.from(sizes),
      residentLevels: resident && (() => resident),
    }) as unknown as PackedDag
  assert.equal(descentLevels(dag([4, 3, 2])), 3, 'the count of its levels')
  assert.equal(descentLevels(dag([4, 3, 2], 2)), 2, 'held to the deepest a resident page needs')
  assert.equal(descentLevels(dag([])), undefined, 'a DAG that counts none reads them all')
})
