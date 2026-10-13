// Proof P3 of #1527: an impostor card whose maps reside in the tile pool draws, at 8 bits, the
// image it drew from its own three textures with their whole mip chains. Nine cards, each seen from
// its own direction — its own three frames and weights — and read at its own level: whole levels,
// fractions between two, and one past the chain's last level, clamped as a sampler clamps. The
// tile path is the engine's card pipelines; the reference is the same program, its reads the
// hardware sampler's on the whole chains (`cardTilesReference.ts`). Until its tiles reside a mesh
// keeps its clusters: that is the CPU's rule, proved by `impostor/cardsReady.test.ts`.
//
//   node bench/dawn/proofs.ts tests/gpu/impostor/card-tiles.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof } from '../kit/enginePageProof.ts'

type Reading = { adapter?: string; cards: number } & ReturnType<
  typeof import('./cardTilesCompare.ts').compareSurfaces
>

test('a card read through the tile pool draws the image its whole chains drew, at 8 bits', async () => {
  const reading = (await runPageProof(
    resolve(import.meta.dirname, 'cardTilesPage.ts'),
    'cardTilesProof',
    'runCardTiles',
  )) as unknown as Reading
  assertSoundProof(reading as unknown as Parameters<typeof assertSoundProof>[0])
  console.log(JSON.stringify(reading))
  const { covered, differ8, maxStep, exact, cards } = reading
  assert.ok(covered > cards * 300, `the cards cover the image: ${covered} texels`)
  assert.equal(differ8, 0, `${differ8} texels differ at 8 bits, by ${maxStep} steps at most`)
  console.log(`${exact} of ${covered} texels differ below 8 bits`)
})
