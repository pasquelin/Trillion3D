import test from 'node:test'
import assert from 'node:assert/strict'
import { PROXY_CHILD_WORDS, PROXY_CHILDREN, PROXY_NODE_WORDS } from '../../../sdk-core/src/index.ts'
import { poseLevels, poseSchedule } from './runtimePoseLevels.ts'

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

const deep = () =>
  tree(5, [
    [0, 1],
    [0, 2],
    [1, 3],
    [3, 4],
  ])

test('the levels list every node once, by depth, the root first', () => {
  assert.deepEqual(
    poseLevels(deep()).map((ranks) => [...ranks]),
    [[0], [1, 2], [3], [4]],
  )
})

test('the poses fit together, the deepest level first, their trees aligned on their roots', () => {
  const { ids, starts, depth } = poseSchedule([poseLevels(deep()), poseLevels(tree(2, [[0, 1]]))])
  assert.equal(depth, 4)
  const step = (s: number) => {
    const pairs: number[][] = []
    for (let at = starts[s]; at < starts[s + 1]; at++) pairs.push([ids[2 * at], ids[2 * at + 1]])
    return pairs
  }
  assert.deepEqual(step(0), [[0, 4]])
  assert.deepEqual(step(1), [[0, 3]])
  assert.deepEqual(step(2), [
    [0, 1],
    [0, 2],
    [1, 1],
  ])
  assert.deepEqual(step(3), [
    [0, 0],
    [1, 0],
  ])
})
