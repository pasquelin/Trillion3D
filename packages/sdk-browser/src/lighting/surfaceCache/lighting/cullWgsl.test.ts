// The cull of the lights of a tile: the box it bounds a tile by spans the depth range the pass before wrote, or the card's whole depth.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslSource } from '../../../../../math/src/wgsl/source.fixture.ts'
import { wgslBufferBindings } from '../../../gpu/core/wgslBindings.fixture.ts'
import { CULL_BINDINGS, CULL_ENTRY, cullWgsl } from './cullWgsl.ts'

test("the tile's box spans the depth range of its word where the cull to the tile's depth range is on, the card's whole depth, 0 to 1, where it is off", () => {
  const text = wgslSource(cullWgsl(4))
  assert.match(
    text,
    /var depths=vec2f\(0\.0,1\.0\);\s*if\(lgFlag\(FLAG_CULL_TO_TILE_DEPTH_RANGE\)\)\{depths=unpack2x16float\(depthRanges\[tile\]\);\}/,
  )
  assert.match(text, /tileBox\(page,coord,depths\)/)
})

test('the cull computes no depth range of its own: it reads the word of the pass before', () => {
  const text = wgslSource(cullWgsl(4))
  assert.doesNotMatch(text, /atomicM(in|ax)/)
  assert.doesNotMatch(text, /texDepth/)
  assert.match(text, /@binding\(7\) var<storage,read> depthRanges:array<u32>;/)
})

test('the cull gives the tile a light tile for each light it keeps, in the slot of the light’s kind, and records where its lights begin and how many', () => {
  const text = wgslSource(cullWgsl(4))
  assert.match(text, /lightsAt=atomicAdd\(&lightTileCounts\[LT_ALLOCATOR\],wanted\);/)
  // The list of light tiles is never written past its room: the picks that do not fit are given back.
  assert.match(
    text,
    /kept=select\(0u,min\(wanted,room-lightsAt\),lightsAt<room\);\s*if\(kept<wanted\)\{atomicSub\(&lightTileCounts\[LT_ALLOCATOR\],wanted-kept\);\}/,
  )
  assert.match(text, /tilesAt=atomicAdd\(&lightTileCounts\[LT_CARD_TILE_ALLOCATOR\],kept\);/)
  assert.match(text, /atomicAdd\(&lightTileCounts\[givenAt\(lightTileSlot\(kind,rank\)\)\],1u\);/)
  assert.match(text, /cardTileOffsets\[tile\*CARD_TILE_OFFSET_WORDS\]=tilesAt;/)
  assert.match(text, /cardTileOffsets\[tile\*CARD_TILE_OFFSET_WORDS\+1u\]=kept;/)
  // The picks are appended by the leading thread alone, which takes the allocators only where the tile keeps a light.
  assert.match(text, /if\(lane==0u\)\{appendTileLights\(tile,kept\);\}/)
  assert.match(
    text,
    /fn appendTileLights\(tile:u32,wanted:u32\)->u32\{\s*var kept=0u;\s*var lightsAt=0u;\s*var tilesAt=0u;\s*if\(wanted>0u\)\{/,
  )
})

test('the cull binds eight storage buffers, the guaranteed limit: the tables, the context, the counters, the tiles’ offsets, the light tiles, the lights, the depth ranges and the bits of the standalone lights', () => {
  const B = CULL_BINDINGS
  assert.deepEqual(wgslBufferBindings(cullWgsl(4)), [
    { binding: 0, type: 'uniform' },
    { binding: B.tables, type: 'read-only-storage' },
    { binding: B.context, type: 'read-only-storage' },
    { binding: B.counts, type: 'storage' },
    { binding: B.cardTileOffsets, type: 'storage' },
    { binding: B.culled, type: 'storage' },
    { binding: B.lights, type: 'read-only-storage' },
    { binding: B.depthRanges, type: 'read-only-storage' },
    { binding: B.standalone, type: 'read-only-storage' },
  ])
})
