// The residency bias: a pool whose places are nearly all in use raises its pressure, one with room
// lowers it, pinned tails past a share of the pool cancel it; the textures the view looks at least
// take the pool's levels to give up, each its own header.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createResidencyBias } from './residencyBias.ts'
import { nextResidencyBias } from './residencyStep.ts'
import type { WebgpuTileAtlas } from './atlas/atlasTypes.ts'
import { TILE_BURST } from './evictSortWgsl.ts'

test('a pool above 95% in use raises its bias, below lowers it, to 0 and 4 at most', () => {
  assert.equal(nextResidencyBias(0, 0.9, 0.1), 0, 'room: no bias to begin with')
  assert.ok(Math.abs(nextResidencyBias(0, 1, 0.1) - 0.01) < 1e-12, 'full: 0.2 of the 5% over')
  assert.ok(
    Math.abs(nextResidencyBias(1, 0.45, 0.1) - 0.9) < 1e-12,
    'half empty: 0.2 of the 50% under',
  )
  assert.equal(nextResidencyBias(0.05, 0.5, 0.1), 0, 'never under zero')
  assert.equal(nextResidencyBias(3.995, 1, 0.1), 4, 'never over four levels')
  assert.equal(nextResidencyBias(2, 1, 0.66), 0, 'pinned tails no bias frees: none')
})

/** An atlas of one pool with `resident` places held of `tiles`, `pinned` of them pinned and
 *  `idle` ranked idle by its last queue, `textures` slots in it, recording the bias written in each header. */
const atlasOf = (tiles: number, resident: number, pinned: number, idle: number, textures = 1) => {
  const written = new Map<number, number>()
  const pool = { tiles, resident, pinned, idle: () => idle }
  const atlas = {
    pools: [pool],
    textures: Array.from({ length: textures }, () => ({ retired: false })),
    poolOf: () => pool,
    pages: { setSlotBias: (slot: number, levels: number) => void written.set(slot, levels) },
  } as unknown as WebgpuTileAtlas
  return { atlas, written }
}
const looked =
  (...pixels: number[]) =>
  () =>
    new Map(pixels.map((count, slot) => [slot, count]))

test('a full pool takes levels from the textures looked at least, up to four each, before the next', () => {
  const { atlas, written } = atlasOf(1000, 1000, 100, 0, 3)
  const bias = createResidencyBias([atlas])
  // The pressure rises 0.01 an image: three textures give up 0.03 levels in all, to the least looked at.
  bias.follow(looked(500, 10, 900))
  assert.ok(Math.abs(written.get(1)! - 0.03) < 1e-12)
  assert.equal(written.has(0), false)
  assert.equal(written.has(2), false)
})

test('the levels to give up pass to the next texture once one has given four', () => {
  const { atlas, written } = atlasOf(1000, 1000, 100, 0, 3)
  const bias = createResidencyBias([atlas])
  for (let image = 0; image < 2000; image++) bias.follow(looked(500, 10, 900))
  assert.equal(written.get(1), 4, 'the least looked at, at the ceiling')
  assert.ok(written.get(0)! > 0, 'the next one gives up the rest')
  assert.ok((written.get(2) ?? 0) <= written.get(0)!, 'the most looked at gives up last')
})

test('a texture the view no longer looks at, or a pool with room, gives its levels back', () => {
  const { atlas, written } = atlasOf(1000, 1000, 100, 0, 2)
  const bias = createResidencyBias([atlas])
  bias.follow(looked(5, 50))
  assert.ok(written.get(0)! > 0)
  bias.follow(() => new Map([[1, 50]]))
  assert.ok(written.get(1)! > 0)
  assert.equal(written.get(0), 0, 'no longer looked at')
})

test('idle places the queue ranks are places no pixel reads: the pool is not full of use', () => {
  const { atlas, written } = atlasOf(1000, 1000, 100, 100)
  const bias = createResidencyBias([atlas])
  bias.follow(looked(10))
  assert.equal(written.size, 0, '90% in use')
})

test('every idle place counts, however many the queue lists: past its burst too', () => {
  // A pool of 20 000 places with 5 000 idle: the queue lists `TILE_BURST` of them, the share is
  // still three quarters in use, so the bias does not rise.
  const idle = 5000
  assert.ok(idle > TILE_BURST)
  const { atlas, written } = atlasOf(20000, 20000, 100, idle)
  const bias = createResidencyBias([atlas])
  bias.follow(looked(10))
  assert.equal(written.size, 0)
})
