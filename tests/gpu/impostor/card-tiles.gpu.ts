// Proof P3 of #1527: an impostor card whose maps reside in the tile pool draws the image it drew
// from its own three textures with their whole mip chains, or a truer one. Nine cards, each seen
// from its own direction — its own three frames and weights — and read at its own level: whole
// levels, fractions between two, and past the chain's last level, clamped as a sampler clamps. The
// tile path is the engine's card pipelines; the reference is the same program, its reads the
// hardware sampler's on the whole chains (`cardTilesReference.ts`). Until its tiles reside a mesh
// keeps its clusters: that is the CPU's rule, proved by `impostor/cardsReady.test.ts`.
//
// At a whole level the pool's read is the hardware's own bilinear, so the drawing is the same at 8
// bits. Between two levels no read through two tiles can carry the hardware's trilinear weight: the
// maps' reads are then set beside the exact filter, in float64, and the pool's error may nowhere
// exceed the hardware's (`cardTileTrilinear.ts`). Texels one drawing covers and the other not —
// the coverage cut met on either side of its threshold — are listed apart, with their coverage
// words.
//
//   node bench/dawn/proofs.ts tests/gpu/impostor/card-tiles.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof } from '../kit/enginePageProof.ts'

type Reading = { adapter?: string; cards: number; lods: number[]; levels: number } & ReturnType<
  typeof import('./cardTilesCompare.ts').compareSurfaces
> & { reads: ReturnType<typeof import('./cardTileTrilinear.ts').compareReads> }

/** Whether the card pass reads a card at a whole level: level 0 asked below zero, which the card
 *  clamps to exactly 0, or a level at or past the chain's last, clamped to it. A level the card
 *  computes as a logarithm lands within a rounding of a whole one, and its two reads mix. */
const wholeCard = (lod: number, levels: number) => lod <= 0 || lod >= levels - 1

test('a card read through the tile pool draws the image its whole chains drew, or a truer one', async () => {
  const reading = (await runPageProof(
    resolve(import.meta.dirname, 'cardTilesPage.ts'),
    'cardTilesProof',
    'runCardTiles',
  )) as unknown as Reading
  assertSoundProof(reading as unknown as Parameters<typeof assertSoundProof>[0])
  const { covered, differ8, maxStep, exact, cards, lods, levels, byCard, flips, reads } = reading
  console.log(`${covered} texels covered, ${differ8} differ at 8 bits by ${maxStep} steps at most`)
  console.log(`${exact} of ${covered} texels differ below 8 bits; ${flips.length} coverage flips`)
  for (const [card, stats] of Object.entries(byCard))
    console.log(`card ${card} (level ${lods[Number(card)]}): ${JSON.stringify(stats)}`)
  for (const flip of flips) console.log(`flip ${JSON.stringify(flip)}`)
  for (const level of reads) console.log(`reads ${JSON.stringify(level)}`)
  assert.ok(covered > cards * 300, `the cards cover the image: ${covered} texels`)
  for (const level of reads)
    if (level.whole)
      assert.equal(level.unequal, 0, `level ${level.lod}: the pool's read is the hardware's`)
    else
      assert.equal(
        level.worse,
        0,
        `level ${level.lod}: the pool's read lies farther from the exact filter than the ` +
          `hardware's at ${level.worse} values, by ${level.excess} steps at most`,
      )
  for (const [card, stats] of Object.entries(byCard))
    if (wholeCard(lods[Number(card)], levels))
      assert.deepEqual(
        [stats.differ8, stats.flips],
        [0, 0],
        `card ${card} at a whole level draws the same image at 8 bits`,
      )
})
