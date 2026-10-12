// Worlds opened and disposed in a row on one device the page keeps (`disposePage.ts`), generated and
// bench scenes in one loop: after each dispose the device holds no buffer or texture the world made
// (the count of live ones is zero), the engine's allocation ledger is back to what the first dispose
// left, and the second time a kind of world is opened the device holds exactly what it held after
// the first. A dispose that kept a texture shows here.
//
//   node bench/dawn/proofs.ts tests/gpu/world/dispose.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof, type PageProofResult } from '../kit/enginePageProof.ts'
import type { Disposals } from './disposePage.ts'

test('worlds disposed in a row leave the device as the first left it', async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'disposePage.ts'),
    'dispose',
  )) as PageProofResult & Disposals
  assertSoundProof(result)
  const { rounds, kinds } = result
  assert.ok(rounds.length >= 20, `${rounds.length} worlds`)
  console.log(
    JSON.stringify({
      live: rounds.map((round) => round.live),
      peak: rounds.map((round) => round.peak),
      bytes: rounds.map((round) => round.bytes),
    }),
  )
  for (const round of rounds) {
    assert.ok(round.peak > 0, `${round.kind}: the world made nothing`)
    assert.equal(round.live, 0, `${round.kind}: ${JSON.stringify(round.labels)} still live`)
  }
  for (let i = kinds.length; i < rounds.length; i++)
    assert.equal(rounds[i].bytes, rounds[i - kinds.length].bytes, `world ${i}: ledger bytes`)
})
