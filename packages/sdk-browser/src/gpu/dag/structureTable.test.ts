// A packing's group structures as the GPU reads them: each primitive's once, behind the others, at
// the base its placements' frame words carry; the words as the structure holds them; and a stack
// bound no walk of the closure kernel passes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createStructureTable, STRUCTURE_HEAD } from './structureTable.ts'
import { structureFamily } from './structureFamily.fixture.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import type { ClusterStructureIndex } from '../../page/selection/types.ts'

test('a structure is placed once, at its first placement, the next behind it', () => {
  const table = createStructureTable()
  const a = structureFamily(1, 40),
    b = structureFamily(2, 24)
  assert.equal(table.baseOf(undefined), NO_INDEX)
  assert.equal(table.baseOf(a), 0)
  const after = table.words
  assert.equal(table.baseOf(a), 0, 'a second placement reads the same base')
  assert.equal(table.baseOf(b), after)
  assert.equal(table.count, 2)
})

test('the words read back the structure: owners, members and outputs', () => {
  const table = createStructureTable(),
    s = structureFamily(3, 32)
  table.baseOf(structureFamily(4, 16))
  const base = table.baseOf(s),
    words = new Uint32Array(table.words)
  table.flush(0, (at, data) => words.set(data, at))
  const pages = words[base],
    groups = words[base + 1]
  assert.equal(pages, s.owners.length)
  assert.equal(groups, s.groupCount)
  const owners = base + STRUCTURE_HEAD,
    childOffsets = owners + pages,
    children = childOffsets + groups + 1,
    outputOffsets = children + s.childOffsets[groups],
    outputs = outputOffsets + groups + 1
  for (let p = 0; p < pages; p++)
    assert.equal(words[owners + p], s.owners[p] < 0 ? NO_INDEX : s.owners[p])
  for (let g = 0; g < groups; g++)
    for (let i = s.childOffsets[g]; i < s.childOffsets[g + 1]; i++) {
      assert.equal(words[childOffsets + g], s.childOffsets[g])
      assert.equal(words[children + i], s.children[i])
    }
  for (let i = 0; i < s.outputOffsets[groups]; i++) assert.equal(words[outputs + i], s.outputs[i])
  assert.equal(words[outputOffsets + groups], s.outputOffsets[groups])
})

/** The most groups a walk from `g` holds on its stack, by walking it: popped last pushed first,
 *  each output's owner pushed, nothing gated — the worst case. */
function walkedStack(s: ClusterStructureIndex, g: number) {
  const stack = [g]
  let most = 1
  while (stack.length) {
    const top = stack.pop()!
    for (let i = s.outputOffsets[top]; i < s.outputOffsets[top + 1]; i++) {
      const owner = s.owners[s.outputs[i]]
      if (owner >= 0) stack.push(owner)
    }
    most = Math.max(most, stack.length)
  }
  return most
}

test('no walk of a generated structure holds more than its stack bound, and one reaches it', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const s = structureFamily(seed, 8 + seed * 13, 2 + (seed % 6))
    const table = createStructureTable()
    table.baseOf(s)
    let most = 0
    for (let g = 0; g < s.groupCount; g++) most = Math.max(most, walkedStack(s, g))
    assert.equal(table.stackBound, most, `seed ${seed}`)
  }
})
