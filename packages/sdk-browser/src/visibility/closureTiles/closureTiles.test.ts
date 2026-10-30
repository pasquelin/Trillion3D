// The closure tiles: the kernels' text, and the clear of the closure slices a record of several closures needs beside the resolve's own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createSurfaceBuffer } from '../../materials/surface/surfaceAllocation.ts'
import { closureClears } from '../../materials/surface/closureClear.ts'
import { reservedNames, unbalanced, unresolvedNames } from '../../gpu/core/wgslNames.fixture.ts'
import {
  CLOSURE_ARGS_BYTES,
  CLOSURE_REGION_HEAD,
  CLOSURE_TILE_SIZE,
  closureArgsAt,
  closureRegionOf,
  closureRegionWords,
  closureTilesWgsl,
  overflowTilesBlock,
  packClosureTile,
  unpackClosureTile,
} from './closureTilesWgsl.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'

test("the kernels count a pixel's closures from its offsets word and list a tile once for each closure past the first", () => {
  const code = closureTilesWgsl()
  assert.deepEqual(unresolvedNames(code), [])
  assert.deepEqual(reservedNames(code), [])
  assert.equal(unbalanced(code), '')
  // One load a pixel: the offsets word is the last layer of the words, a closure counted by each step that is not zero; the size comes from the target.
  assert.equal(code.match(/textureLoad/g)?.length, 1)
  assert.match(code, /i32\(layers\)-1,0\)\.x/)
  assert.match(code, /textureDimensions\(words\)/)
  // A pixel counts no closure past what the record holds.
  assert.match(
    code,
    /closureCountOf\(textureLoad\(words,vec2i\(pixel\),i32\(layers\)-1,0\)\.x,closuresHeldOf\(layers\)\)/,
  )
  assert.doesNotMatch(code, /params/)
  assert.match(code, new RegExp(`@workgroup_size\\(${CLOSURE_TILE_SIZE},${CLOSURE_TILE_SIZE},1\\)`))
  // The entry packs twelve bits a coordinate, four the index and four the count.
  assert.match(
    code,
    /\(tile\.x&4095u\)\|\(\(tile\.y&4095u\)<<12u\)\|\(\(index&15u\)<<24u\)\|\(\(count&15u\)<<28u\)/,
  )
  // A region of the list a closure past the first: its count by an atomic, the entry after the head.
  assert.match(code, /atomicAdd\(&tileList\[region\],1u\)/)
  assert.match(code, /tileArgs\[3u\*k\]=min\(count,along\)/)
  assert.match(code, /tileArgs\[3u\*k\+1u\]=\(count\+along-1u\)\/along/)
})

test("a closure's region of the list is a storage binding of its own: 256 bytes aligned, its head and an entry a tile", () => {
  for (const tiles of [
    [1, 1],
    [240, 135],
    [1024, 1024],
  ] as const) {
    const words = closureRegionWords(tiles)
    assert.equal(words % 64, 0, 'a storage binding may start at 256 bytes on any device')
    assert.ok(
      words >= CLOSURE_REGION_HEAD + tiles[0] * tiles[1],
      'a tile lists once for each closure at most',
    )
    assert.ok(words < CLOSURE_REGION_HEAD + tiles[0] * tiles[1] + 64)
    assert.deepEqual(closureRegionOf(tiles, 1), { offset: 0, size: 4 * words })
    assert.deepEqual(closureRegionOf(tiles, 3), { offset: 8 * words, size: 4 * words })
  }
  // The dispatch of a closure is three words after the one before, and the arguments hold the most closures past the first.
  assert.equal(closureArgsAt(1), 0)
  assert.equal(closureArgsAt(4), 36)
  assert.equal(CLOSURE_ARGS_BYTES, closureArgsAt(8))
  // The kernel strides its regions by the same count the CPU mirror gives.
  const code = closureTilesWgsl()
  assert.match(code, /return \(2u\+tiles\.x\*tiles\.y\+63u\)\/64u\*64u;/)
})

test('an entry packs a tile, the index of its closure and the count of closures of the tile, and the reader finds the entry a workgroup of the dispatch stands for', () => {
  const word = packClosureTile(37, 3000, 3, 5)
  assert.deepEqual(unpackClosureTile(word), { x: 37, y: 3000, index: 3, count: 5 })
  assert.equal(
    unpackClosureTile(packClosureTile(4096 + 5, 8192 + 7, 16 + 2, 32 + 1)).x,
    5,
    'the fields are masked',
  )
  // A region of 7 entries over 3 tiles a row: the head says so, the dispatch is 3 workgroups wide and 3 rows high.
  const along = 3
  const list = [
    7,
    along,
    ...Array.from({ length: 7 }, (_, at) => packClosureTile(at, 9 - at, 1, 2)),
  ]
  const read = shaderRun<{ overflowTileAt: (group: number[]) => number[] }>(
    overflowTilesBlock(1),
    ['overflowTileAt'],
    { overflowList: list },
  )
  assert.deepEqual(read.overflowTileAt([0, 0, 0]), [0, 9, 1])
  assert.deepEqual(
    read.overflowTileAt([2, 1, 0]),
    [5, 4, 1],
    'a row and two along: the sixth entry',
  )
  assert.deepEqual(read.overflowTileAt([0, 2, 0]), [6, 3, 1], 'the last row holds one')
  assert.deepEqual(
    read.overflowTileAt([1, 2, 0]),
    [0, 0, 0],
    'the workgroups past the count are not listed',
  )
})

test('the closure slices are cleared beside the resolve, in passes of the attachments a sample holds', () => {
  const plain = fakeDevice({ limits: { maxTextureDimension2D: 4096 } })
  assert.deepEqual(closureClears(createSurfaceBuffer(plain.device, 16, 16)), [])
  const clearsOf = (closures: number) => {
    const { device } = fakeDevice({ limits: { maxTextureDimension2D: 4096 } })
    const record = createSurfaceBuffer(device, 16, 16, { closures })
    const passes = closureClears(record)
    assert.equal(closureClears(record), passes, 'made once for a record')
    return passes.map((pass) => [...pass.colorAttachments].length)
  }
  // The words (a coverage a closure, the flags and lobes texel of each closure past the first and the offsets, eight to a pass), then the normal and roughness of each closure past the first (four half-float texels to a pass);
  // the other colours are read under the coverages.
  assert.deepEqual(clearsOf(2), [8, 1])
  assert.deepEqual(clearsOf(3), [8, 6, 2])
  assert.deepEqual(clearsOf(8), [8, 8, 8, 8, 8, 4, 4, 3])
})
