// The roots' double worlds grow on the GPU (`rootWorlds.ts`): a world the composition wrote — one
// the CPU never sends — survives the tables outgrowing their roots, as the world boxes do, so no
// pass reads a zeroed world between the growth and the next composition; and roots the running cut
// took in place before they join are sent at their ranks and listed for the root boxes pass, the
// one writer of their stretch. Generated roots, one composed under a parent.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { NO_INDEX } from '../../../math/src/constants.ts'
import { packDoubles } from '../../../math/src/float/splitDouble.ts'
import { destroyRetired } from '../gpu/core/frameRetire.ts'
import { sendRootWorlds } from './rootWorlds.ts'
import { ROOT_WORLD_WORDS } from './rootWorldSends.ts'

const at = (x: number) => ({
  world: { elements: Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1) },
})

test('a composed world survives the root tables growing', () => {
  const fake = fakeDevice(),
    device = fake.device as unknown as GPUDevice
  const selectionRoots = [at(1), at(2)],
    parentOf = new Uint32Array(64).fill(NO_INDEX)
  // Root 1 is composed: its world is the GPU's, never the CPU's.
  parentOf[1] = 0
  const rt = {
    layout: { selectionRoots, rows: { tableEpoch: 0 } },
    compose: { roots: 64, parentOf },
  } as never as Parameters<typeof sendRootWorlds>[0]
  sendRootWorlds(rt, device)
  // The composition writes root 1's world on the GPU.
  const composed = Uint32Array.from({ length: ROOT_WORLD_WORDS }, (_, k) => 0x1000 + k)
  const before = rt.rootWorlds!.worlds!
  device.queue.writeBuffer(before, ROOT_WORLD_WORDS * 4, composed)
  for (let x = 3; x <= 40; x++) selectionRoots.push(at(x))
  sendRootWorlds(rt, device)
  const after = rt.rootWorlds!.worlds!
  assert.notEqual(after, before, 'the tables grew')
  // The image being encoded may still name the old tables: retired, freed after its submit.
  assert.ok(!fake.destroyed.includes(before), 'the old worlds are not destroyed at the growth')
  destroyRetired(device)
  assert.ok(fake.destroyed.includes(before), 'and go once the frame is submitted')
  const words = new Uint32Array((after as unknown as { data: Uint8Array }).data.buffer)
  assert.deepEqual(
    Array.from(words.subarray(ROOT_WORLD_WORDS, 2 * ROOT_WORLD_WORDS)),
    Array.from(composed),
    'the composed world, copied on the GPU',
  )
})

test('roots a cut took in place before they join are sent and listed for the root boxes pass', () => {
  const fake = fakeDevice(),
    device = fake.device as unknown as GPUDevice
  const growth = { roots: [at(3), at(4)], appended: 0 }
  const rt = {
    layout: { selectionRoots: [at(1), at(2)], rows: { tableEpoch: 0 } },
    growth,
  } as never as Parameters<typeof sendRootWorlds>[0]
  sendRootWorlds(rt, device)
  const held = rt.rootWorlds!
  held.roots.whole = held.rows.whole = false
  // The running cut appends both in place (`startGrownCut`): their stretch is the pass's to write.
  growth.appended = 2
  sendRootWorlds(rt, device)
  assert.deepEqual(Array.from(held.roots.ranks.subarray(0, held.roots.count)), [2, 3])
  assert.equal(held.rows.count, 0, 'their rows wait for them to join')
  assert.deepEqual([held.sent, held.held], [2, 4])
  const words = new Uint32Array((held.worlds as unknown as { data: Uint8Array }).data.buffer),
    expected = new Uint32Array(ROOT_WORLD_WORDS)
  packDoubles(expected, 0, growth.roots[1].world.elements)
  assert.deepEqual(
    Array.from(words.subarray(3 * ROOT_WORLD_WORDS, 4 * ROOT_WORLD_WORDS)),
    Array.from(expected),
    'the world of the second, at its rank',
  )
})
