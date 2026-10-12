// Twenty worlds opened and disposed in a row on one device the page keeps (`disposeWorldsPage.ts`),
// skinned, morphed, textured, blended and mirrored: the second time a scene is opened, the device
// holds what it held after the first — what a world made is destroyed, by label, and nothing more
// is held.
//
//   node bench/dawn/proofs.ts tests/gpu/world/dispose-worlds.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof, type PageProofResult } from '../kit/enginePageProof.ts'
import type { WorldDisposals } from './disposeWorldsPage.ts'

test('twenty bench worlds disposed in a row leave the device as the first left it', async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'disposeWorldsPage.ts'),
    'disposeWorlds',
  )) as PageProofResult & WorldDisposals
  assertSoundProof(result)
  const { rounds, scenes } = result
  assert.equal(rounds.length, 20)
  console.log(
    JSON.stringify({
      peak: rounds.map((round) => round.peak),
      live: rounds.map((round) => round.live),
    }),
  )
  for (const round of rounds) assert.ok(round.peak > 0, `${round.scene}: the world made nothing`)
  for (let i = scenes.length; i < rounds.length; i++) {
    const before = rounds[i - scenes.length],
      round = rounds[i]
    assert.deepEqual(round.labels, before.labels, `world ${i} (${round.scene}) kept resources`)
  }
})
