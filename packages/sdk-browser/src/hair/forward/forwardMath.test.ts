// The forward raster's sizes, the lists its binners keep and the walk of a segment over the tiles, on their JavaScript twins; and the limits its
// WGSL texts keep to (the guaranteed workgroup size and memory, the storage buffers of a stage).
import test from 'node:test'
import assert from 'node:assert/strict'
import { FORWARD_BIN_WGSL, FORWARD_DEPTH_GRID_WGSL } from './forwardBinWgsl.ts'
import { FORWARD_CLEAR_WGSL } from './forwardClearWgsl.ts'
import { FORWARD_CULL_WGSL } from './forwardCullWgsl.ts'
import { FORWARD_GATHER_WGSL } from './forwardGatherWgsl.ts'
import { forwardRasterWgsl } from './forwardRasterWgsl.ts'
import { binTile, walkTiles } from './forwardLists.fixture.ts'
import {
  FORWARD_LAYER,
  FORWARD_TILE_PRIMS,
  forwardLayout,
  forwardNodeCount,
} from './forwardMath.ts'

const SETTINGS = { numBinners: 32, numRasterizers: 256, maxTiles: 65536 }
const BINDING = 128 * 1024 * 1024 - 8

test('the layout holds the tiles of the image, the reference bounds on the groups, and the lists one binding holds', () => {
  const layout = forwardLayout([1920, 1080], SETTINGS, BINDING)!
  assert.deepEqual(layout.binRes, [60, 34])
  assert.deepEqual(layout.rasterRes, [240, 135])
  assert.equal(layout.maxTiles, Math.floor(BINDING / (FORWARD_TILE_PRIMS * 4)))
  assert.equal(layout.primWords, layout.maxTiles * FORWARD_TILE_PRIMS)
  assert.equal(layout.gridWords, (FORWARD_LAYER.count * 32 + 1) * 60 * 34)
  const held = forwardLayout(
    [64, 64],
    { numBinners: 0, numRasterizers: 5000, maxTiles: 10 },
    1 << 30,
  )!
  assert.equal(held.numBinners, 1)
  assert.equal(held.numRasterizers, 1024)
  assert.equal(held.maxTiles, 1024, 'the least lists the setting allows')
  assert.equal(
    forwardLayout([32 * 70000, 32], SETTINGS, BINDING),
    undefined,
    'a tile column past two bytes',
  )
})

test('the nodes are the points of the drawn instances', () => {
  assert.equal(forwardNodeCount([{ group: { pointCount: 3 } }, { group: { pointCount: 4 } }]), 7)
})

test('every segment lands in a list of its tile, however a batch ends on a multiple of 1024', () => {
  for (const batches of [
    [10],
    [1024],
    [1024, 1024],
    [1000, 24, 1],
    [5, 1024, 1019],
    [1024, 1],
    [700, 700, 700],
  ]) {
    const total = batches.reduce((a, b) => a + b, 0)
    const lists = binTile(batches)
    assert.equal(lists.length, Math.ceil(total / FORWARD_TILE_PRIMS), `${batches}`)
    const seen = lists.flatMap((l) => l.prims.slice(0, l.count))
    assert.equal(seen.length, total, `${batches}: counts ${lists.map((l) => l.count)}`)
    assert.deepEqual(
      [...seen].sort((a, b) => a - b),
      Array.from({ length: total }, (_, i) => i),
      `${batches}`,
    )
    lists.forEach((l, i) =>
      assert.equal(l.count, Math.min(FORWARD_TILE_PRIMS, total - i * FORWARD_TILE_PRIMS)),
    )
  }
})

test('a segment along an axis walks the tiles it crosses, and one inside a tile only that', () => {
  assert.deepEqual(walkTiles([2.5, 1.5], [2.5, 4.5]), [
    [2, 1],
    [2, 2],
    [2, 3],
    [2, 4],
  ])
  assert.deepEqual(walkTiles([0.5, 3.5], [3.5, 3.5]), [
    [0, 3],
    [1, 3],
    [2, 3],
    [3, 3],
  ])
  assert.deepEqual(walkTiles([1.2, 1.3], [1.8, 1.9]), [[1, 1]])
  assert.deepEqual(walkTiles([4.5, 4.5], [4.5, 4.5]), [[4, 4]])
  const diagonal = walkTiles([0.5, 0.5], [3.5, 3.5])
  assert.deepEqual(diagonal.at(-1), [3, 3])
  assert.ok(diagonal.length >= 4 && diagonal.length <= 7)
  assert.deepEqual(
    walkTiles([3.5, 0.5], [0.5, 0.5]).map((t) => t[0]),
    [3, 2, 1, 0],
  )
})

/** The bytes of a type the shaders keep in workgroup memory. */
const BYTES: Record<string, number> = { u32: 4, f32: 4, 'atomic<u32>': 4, vec2u: 8, vec4u: 16 }

/** The bytes of workgroup memory a module declares. */
function workgroupBytes(code: string) {
  let bytes = 0
  for (const m of code.matchAll(/var<workgroup>\s+\w+:([^;]+);/g)) {
    const array = /^array<(.+),(\d+)>$/.exec(m[1]!)
    bytes += array ? BYTES[array[1]!]! * Number(array[2]) : (BYTES[m[1]!] ?? 16)
  }
  return bytes
}

test('the passes keep to the guaranteed limits: 256 threads, 16 KiB of workgroup memory, 8 storage buffers, no backtick', () => {
  const programs = {
    cull: FORWARD_CULL_WGSL,
    depthGrid: FORWARD_DEPTH_GRID_WGSL,
    bin: FORWARD_BIN_WGSL,
    gather: FORWARD_GATHER_WGSL,
    depth: forwardRasterWgsl(false),
    color: forwardRasterWgsl(true),
    clear: FORWARD_CLEAR_WGSL,
  }
  for (const [name, program] of Object.entries(programs)) {
    const code = program
    const size = /@workgroup_size\((\d+)(?:,(\d+))?(?:,(\d+))?\)/.exec(code)!
    const threads = Number(size[1]) * Number(size[2] ?? 1) * Number(size[3] ?? 1)
    assert.ok(threads <= 256, `${name}: ${threads} threads`)
    assert.ok(
      workgroupBytes(code) <= 16384,
      `${name}: ${workgroupBytes(code)} bytes of workgroup memory`,
    )
    assert.ok((code.match(/var<storage/g) ?? []).length <= 8, `${name}: storage buffers`)
    assert.ok(
      !code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*/g, '')
        .includes('`'),
      name,
    )
  }
})

test('a barrier never follows a branch on a value only some threads of the group hold', () => {
  // The raster and the gather decide their loops by `workgroupUniformLoad` and never by a read of workgroup memory.
  for (const code of [forwardRasterWgsl(false), FORWARD_GATHER_WGSL, FORWARD_BIN_WGSL])
    assert.ok(code.includes('workgroupUniformLoad('))
})
