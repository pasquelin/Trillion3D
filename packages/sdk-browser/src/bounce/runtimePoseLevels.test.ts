import test from 'node:test'
import assert from 'node:assert/strict'
import { PROXY_CHILD_WORDS, PROXY_CHILDREN, PROXY_NODE_WORDS } from '../../../sdk-core/src/index.ts'
import { nodeLevels } from './runtimePoseLevels.ts'

/** A tree of `links` as `[parent, child]` pairs: a child slot's words say node (`1 << 24`, no triangles). */
function tree(nodes: number, links: [number, number][]) {
  const words = new Uint32Array(nodes * PROXY_NODE_WORDS)
  const used = new Array<number>(nodes).fill(0)
  for (const [parent, child] of links) {
    const base = parent * PROXY_NODE_WORDS + used[parent]++ * PROXY_CHILD_WORDS
    assert.ok(used[parent] <= PROXY_CHILDREN)
    words[base + 1] = 1 << 24
    words[base + 2] = child
  }
  return words
}

test('the levels list every node once, by depth, the root first', () => {
  const order = nodeLevels(
    tree(5, [
      [0, 1],
      [0, 2],
      [1, 3],
      [3, 4],
    ]),
  )
  const levels = order[0]
  assert.equal(levels, 4)
  const starts = [...order.slice(1, 2 + levels)]
  assert.deepEqual(starts, [0, 1, 3, 4, 5])
  assert.deepEqual([...order.slice(2 + levels)], [0, 1, 2, 3, 4])
})
