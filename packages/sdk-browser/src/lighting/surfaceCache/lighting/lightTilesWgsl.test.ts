// The light tiles of the direct update: the programs that count, place and compact them assemble at the bindings their kernels lay, and
// run in JavaScript on their shipped text they give every slot its own run of the compacted list, the sun that needs no shadow mask included.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { wgslBufferBindings } from '../../../gpu/core/wgslBindings.fixture.ts'
import { dispatchGrid } from '../../../gpu/dispatch/grid.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import {
  BATCHABLE_LIGHT_TYPES,
  LIGHT_TILE_ARGS,
  LIGHT_TILE_ARGS_WORDS,
  LIGHT_TILE_COUNTS,
  LIGHTING_FLAG,
  lightSlotsOf,
  lightTileArgsWords,
  lightTileCountsWords,
  TILE_LIGHT_STANDALONE,
} from './layout.ts'
import {
  LIGHT_TILE_COMPACT_BINDINGS,
  LIGHT_TILE_COMPACT_ENTRY,
  LIGHT_TILE_COMPACT_WGSL,
  LIGHT_TILE_COUNTS_BINDINGS,
  LIGHT_TILE_COUNTS_ENTRIES,
  LIGHT_TILE_COUNTS_WGSL,
} from './lightTilesWgsl.ts'

const HEAD = LIGHT_TILE_COUNTS.head
const SLOTS = 8
type Given = Record<number, number>

/** The slot of the light of rank `rank` and the one of the batchable type `kind` (1 a point light, 2 a spot, 3 a rectangle). */
const lightSlot = (rank: number) => BATCHABLE_LIGHT_TYPES + rank
const typeSlot = (kind: number) => kind - 1

/** The words of the counters of `slots` slots with the light tiles each was given. */
function countsOf(given: Given, slots = SLOTS) {
  const words = new Array<number>(lightTileCountsWords(slots)).fill(0)
  for (const [slot, n] of Object.entries(given)) words[HEAD + Number(slot)] = n
  words[LIGHT_TILE_COUNTS.allocator] = Object.values(given).reduce((sum, n) => sum + n, 0)
  return words
}
const placedAt = (slot: number, slots = SLOTS) => HEAD + slots + slot
const offsetAt = (slot: number, slots = SLOTS) => HEAD + 2 * slots + slot
const offsetsOf = (words: number[], slots = SLOTS) =>
  Array.from({ length: slots }, (_, slot) => words[offsetAt(slot, slots)])

const counting = (words: number[], args: number[] = []) =>
  shaderRun<{
    lightTilesClear: (lane: number) => void
    lightTilesOffsets: () => void
    lightTilesArgs: (id: number[]) => void
    lightTilesClearCompacted: (lane: number) => void
  }>(LIGHT_TILE_COUNTS_WGSL, [...LIGHT_TILE_COUNTS_ENTRIES], {
    lightTileCounts: words,
    lightTileArgs: args,
    GROUP_WIDTH: 65535,
  })

test('the programs assemble at the bindings the kernels lay: the counters and the arguments; the counters, the context, the tables and the lists', () => {
  for (const entry of LIGHT_TILE_COUNTS_ENTRIES)
    assertProgramAssembles(LIGHT_TILE_COUNTS_WGSL, entry)
  assertProgramAssembles(LIGHT_TILE_COMPACT_WGSL, LIGHT_TILE_COMPACT_ENTRY)
  const A = LIGHT_TILE_COUNTS_BINDINGS
  assert.deepEqual(wgslBufferBindings(LIGHT_TILE_COUNTS_WGSL), [
    { binding: A.counts, type: 'storage' },
    { binding: A.args, type: 'storage' },
  ])
  const C = LIGHT_TILE_COMPACT_BINDINGS
  assert.deepEqual(wgslBufferBindings(LIGHT_TILE_COMPACT_WGSL), [
    { binding: 0, type: 'uniform' },
    { binding: C.counts, type: 'storage' },
    { binding: C.context, type: 'read-only-storage' },
    { binding: C.tables, type: 'read-only-storage' },
    { binding: C.culled, type: 'read-only-storage' },
    { binding: C.compacted, type: 'storage' },
    { binding: C.cardTileOffsets, type: 'read-only-storage' },
    { binding: C.cardTileLights, type: 'storage' },
  ])
})

test('the counters and the arguments are laid for the slots of a scene: the types’ and a slot a light, raised to a power of two', () => {
  assert.equal(lightSlotsOf(0), 4)
  assert.equal(lightSlotsOf(1), 4)
  assert.equal(lightSlotsOf(2), 8)
  assert.equal(lightSlotsOf(61), 64)
  assert.equal(lightTileCountsWords(SLOTS), HEAD + 3 * SLOTS)
  assert.equal(lightTileArgsWords(SLOTS), LIGHT_TILE_ARGS_WORDS * (LIGHT_TILE_ARGS.slots + SLOTS))
})

test('the first clear empties the counters of the light tiles given out and those each slot was given, the second the ones it has placed, nothing else', () => {
  const words = new Array<number>(lightTileCountsWords(SLOTS)).fill(7)
  const run = counting(words)
  for (let lane = 0; lane < 64; lane++) run.lightTilesClear(lane)
  assert.deepEqual(words.slice(0, HEAD + SLOTS), new Array(HEAD + SLOTS).fill(0))
  assert.deepEqual(words.slice(HEAD + SLOTS), new Array(2 * SLOTS).fill(7))
  for (let lane = 0; lane < 64; lane++) run.lightTilesClearCompacted(lane)
  assert.deepEqual(words.slice(HEAD + SLOTS, HEAD + 2 * SLOTS), new Array(SLOTS).fill(0))
  assert.deepEqual(words.slice(HEAD + 2 * SLOTS), new Array(SLOTS).fill(7))
})

// Ranks 0 (a sun that casts a shadow), 1 (a sun that casts none and wears no function: it needs no shadow mask) and 2 (a light apart
// from the atlas) hold the slots of their rank; 2, 3 and 0 tiles went to the point lights, the spots and the rectangles.
const GIVEN: Given = {
  [typeSlot(1)]: 2,
  [typeSlot(2)]: 3,
  [lightSlot(0)]: 4,
  [lightSlot(1)]: 5,
  [lightSlot(2)]: 6,
}

/** The offsets of the reference's prefix sum: it walks the lights in `walked` — those that need a shadow mask and are not batched — and
 *  then the batchable types, so that the slot of a light it does not walk keeps the offset it held. */
function referenceOffsets(given: Given, walked: number[], held = 0) {
  const offsets = new Array<number>(SLOTS).fill(held)
  let offset = 0
  for (const rank of walked) {
    offsets[lightSlot(rank)] = offset
    offset += given[lightSlot(rank)] ?? 0
  }
  for (let kind = 1; kind <= BATCHABLE_LIGHT_TYPES; kind++) {
    offsets[typeSlot(kind)] = offset
    offset += given[typeSlot(kind)] ?? 0
  }
  return offsets
}

/** That the runs `[offset, offset + given)` of the slots lie one after the other from 0, none overlapping, and fill the list. */
function assertRunsTile(offsets: number[], given: Given, message: string) {
  const runs = Object.entries(given)
    .map(([slot, n]) => [offsets[Number(slot)], n] as const)
    .sort((a, b) => a[0] - b[0])
  let end = 0
  for (const [offset, n] of runs) {
    assert.equal(offset, end, message)
    end = offset + n
  }
}

test('every slot has its place: the slots of the lights in order of rank, then the types’, the sun that needs no shadow mask among them', () => {
  const words = countsOf(GIVEN)
  counting(words).lightTilesOffsets()
  // The lights: 4 tiles from 0, then 5, then 6, the empty slots after; the types follow at 15, 17 and 20.
  assert.deepEqual(offsetsOf(words), [15, 17, 20, 0, 4, 9, 15, 15])
  assertRunsTile(offsetsOf(words), GIVEN, 'the runs of the slots tile the compacted list')
})

test('the walk of the lights that need a mask, as the reference makes it, puts the tiles of a sun that needs none on the first light’s; the shipped sum does not', () => {
  const walked = referenceOffsets(GIVEN, [0, 2])
  assert.throws(() => assertRunsTile(walked, GIVEN, 'overlap'), /overlap/)
  const words = countsOf(GIVEN)
  counting(words).lightTilesOffsets()
  assertRunsTile(offsetsOf(words), GIVEN, 'overlap')
})

test('the arguments name the groups of the compaction, of the slots of the lights together and of each slot, in rows of the device’s width', () => {
  const given: Given = {
    [typeSlot(1)]: 2,
    [typeSlot(3)]: 70,
    [lightSlot(0)]: 4,
    [lightSlot(2)]: 130_000,
  }
  const words = countsOf(given)
  const args = new Array<number>(lightTileArgsWords(SLOTS)).fill(0)
  const run = counting(words, args)
  run.lightTilesOffsets()
  for (let thread = 0; thread < 64; thread++) run.lightTilesArgs([thread, 0, 0])
  const at = (entry: number) =>
    args.slice(entry * LIGHT_TILE_ARGS_WORDS, (entry + 1) * LIGHT_TILE_ARGS_WORDS)
  assert.deepEqual(at(LIGHT_TILE_ARGS.compaction), [...dispatchGrid(Math.ceil(130_076 / 64)), 1])
  assert.deepEqual(
    at(LIGHT_TILE_ARGS.lights),
    [...dispatchGrid(130_004), 1],
    'the slots of the lights together, the types’ left out',
  )
  for (let slot = 0; slot < SLOTS; slot++)
    assert.deepEqual(
      at(LIGHT_TILE_ARGS.slots + slot),
      [...dispatchGrid(given[slot] ?? 0), 1],
      `slot ${slot}`,
    )
})

const compacting = (scope: object) =>
  shaderRun<{ lightTilesCompact: (id: number[], n: number[]) => void }>(
    LIGHT_TILE_COMPACT_WGSL,
    [LIGHT_TILE_COMPACT_ENTRY],
    scope,
  )

/** The light word of a tile's light: its rank, the top bit where the atlas holds no slot of its function. */
const lightOf = (rank: number, standalone = false) =>
  (rank | (standalone ? TILE_LIGHT_STANDALONE : 0)) >>> 0
/** A culled light tile's second word: the light, its place among the tile's and its kind (0 for a sun or a light apart from the atlas). */
const culledWord = (light: number, place: number, kind: number) =>
  (light | (place << 14) | (kind << 22)) >>> 0

test('the compaction puts each light tile in the run of its slot, and in the list of its tile at the place the cull picked it, with the place it took', () => {
  // Two tiles of the update's list. Tile 0 keeps a point light (rank 5), a sun (rank 0) and a light apart from the atlas (rank 2);
  // tile 1 keeps the point light again and a rectangle (rank 7).
  const picked = [
    { tile: 0, light: lightOf(5), place: 0, kind: 1 },
    { tile: 0, light: lightOf(0), place: 1, kind: 0 },
    { tile: 0, light: lightOf(2, true), place: 2, kind: 0 },
    { tile: 1, light: lightOf(5), place: 0, kind: 1 },
    { tile: 1, light: lightOf(7), place: 1, kind: 3 },
  ]
  const slots = 32
  const ctx = [0x00a00011, 0x00a00022]
  const given: Given = {}
  for (const { light, kind } of picked) {
    const slot = kind > 0 ? typeSlot(kind) : lightSlot(light & 0x3fff)
    given[slot] = (given[slot] ?? 0) + 1
  }
  const counts = countsOf(given, slots)
  shaderRun<{ lightTilesOffsets: () => void }>(LIGHT_TILE_COUNTS_WGSL, ['lightTilesOffsets'], {
    lightTileCounts: counts,
  }).lightTilesOffsets()
  const compacted = new Array<number>(picked.length * 2).fill(-1)
  const cardTileLights = new Array<number>(picked.length * 2).fill(-1)
  const run = compacting({
    lightTileCounts: counts,
    ctx,
    lp: { directAt: 0, indirectAt: 2, flags: LIGHTING_FLAG.lightTilesPerType },
    culledTiles: picked.flatMap(({ tile, light, place, kind }) => [
      tile,
      culledWord(light, place, kind),
    ]),
    compactedTiles: compacted,
    // Tile 0's lights begin at 0 in the tiles' lists, three of them; tile 1's at 3, two.
    cardTileOffsets: [0, 3, 3, 2],
    cardTileLights,
  })
  for (let i = 0; i < picked.length; i++) run.lightTilesCompact([i, 0, 0], [1, 1, 1])
  // The lights' slots come first (rank 0's, rank 2's), then the point lights' and the rectangles'.
  const offsets = offsetsOf(counts, slots)
  assert.deepEqual(
    [lightSlot(0), lightSlot(2), typeSlot(1), typeSlot(3)].map((slot) => offsets[slot]),
    [0, 1, 2, 4],
  )
  const entry = (at: number) => [compacted[2 * at], compacted[2 * at + 1]]
  assert.deepEqual(entry(0), [ctx[0], lightOf(0)], 'the sun, first of the lights’ slots')
  assert.deepEqual(
    entry(1),
    [ctx[0], lightOf(2, true)],
    'the light apart from the atlas keeps its mark',
  )
  assert.deepEqual(entry(2), [ctx[0], lightOf(5)], 'the point lights of both tiles share a run')
  assert.deepEqual(entry(3), [ctx[1], lightOf(5)])
  assert.deepEqual(entry(4), [ctx[1], lightOf(7)], 'the rectangle')
  // Each tile's list holds its lights where the cull picked them, with the place of their light tile in the compacted list.
  assert.deepEqual(cardTileLights, [
    lightOf(5),
    2,
    lightOf(0),
    0,
    lightOf(2, true),
    1,
    lightOf(5),
    3,
    lightOf(7),
    4,
  ])
  assert.equal(counts[placedAt(lightSlot(0), slots)], 1, 'the compaction counts what it placed')
  assert.equal(counts[placedAt(typeSlot(1), slots)], 2)
})

test('with the batching by type off every light tile lies in the slot of its rank, whatever its kind', () => {
  const rank = 4
  const counts = countsOf({ [lightSlot(rank)]: 1 })
  counting(counts).lightTilesOffsets()
  const compacted = [-1, -1]
  compacting({
    lightTileCounts: counts,
    ctx: [123],
    lp: { directAt: 0, indirectAt: 1, flags: 0 },
    culledTiles: [0, culledWord(lightOf(rank), 0, 2)],
    compactedTiles: compacted,
    cardTileOffsets: [0, 1],
    cardTileLights: [-1, -1],
  }).lightTilesCompact([0, 0, 0], [1, 1, 1])
  assert.deepEqual(compacted, [123, lightOf(rank)])
  assert.equal(counts[placedAt(lightSlot(rank))], 1, 'the slot of its rank placed it')
  assert.equal(counts[placedAt(typeSlot(2))], 0, 'its kind’s slot did not')
})
