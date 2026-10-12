// Twenty worlds opened and disposed in a row on one device (`disposeLeakPage.ts`): after each
// dispose the engine's allocation ledger and the count of live buffers and textures return to what
// the first dispose left, whatever the world drew. A dispose that kept a texture shows here.
//
//   node bench/dawn/proofs.ts tests/gpu/world/dispose-leak.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof, type PageProofResult } from '../kit/enginePageProof.ts'
import type { Disposals } from './disposeLeakPage.ts'

test('twenty worlds disposed in a row leave the device as the first left it', async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'disposeLeakPage.ts'),
    'disposeLeak',
  )) as PageProofResult & Disposals
  assertSoundProof(result)
  const { rounds, kinds } = result
  assert.equal(rounds.length, 20)
  console.log(
    JSON.stringify({
      live: rounds.map((r) => r.live),
      peak: rounds.map((r) => r.peak),
      bytes: rounds.map((r) => r.bytes),
    }),
  )
  // The second time a kind of world is opened, the device holds what it held after the first:
  // what the world shares stays, what it made is gone.
  for (let i = kinds.length; i < rounds.length; i++) {
    const before = rounds[i - kinds.length],
      round = rounds[i]
    assert.deepEqual(round.labels, before.labels, `world ${i} (${round.kind}) kept resources`)
    assert.equal(round.bytes, before.bytes, `world ${i} (${round.kind}): ledger bytes`)
  }
})
