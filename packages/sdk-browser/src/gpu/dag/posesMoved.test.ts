// A send says which poses it moved — the placements whose read words moved and those whose exact
// translation alone did —, each once, increasing: the two lists, each increasing already, joined
// in one pass, nothing sorted. On a generated field of 1600 placements, 200 rounds of moves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from './placementTree.fixture.ts'
import { createGpuDagSelection, packDagSelection } from './selection.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'

test('the poses a send moved come back each once, increasing, nothing sorted', async () => {
  installGpuGlobals()
  const roots = placementField(40, 6),
    packed = packDagSelection(roots)
  const selection = (await createGpuDagSelection(mockGpu({ packed }).device, packed))!
  const next = random(4271),
    sort = Int32Array.prototype.sort
  let sorts = 0
  Int32Array.prototype.sort = function (this: Int32Array, ...args) {
    sorts++
    return sort.apply(this, args)
  }
  try {
    for (let round = 0; round < 200; round++) {
      const worlds = packed.worlds.slice(),
        expected = new Set<number>()
      for (let k = 0; k < 12; k++) {
        const w = Math.floor(next() * roots.length),
          elements = roots[w].world.elements as Float64Array
        // A turn moves its read words; a millimetre along x its exact translation alone.
        if (next() < 0.5) elements[0] *= 1.5
        else elements[12] += 0.001
        worlds.set(elements, w * 16)
        expected.add(w)
      }
      const moved = [...selection.updateWorlds(worlds)]
      assert.deepEqual(
        moved,
        [...expected].sort((a, b) => a - b),
        `round ${round}`,
      )
    }
  } finally {
    Int32Array.prototype.sort = sort
  }
  assert.equal(sorts, 0, 'joined in one pass')
})
