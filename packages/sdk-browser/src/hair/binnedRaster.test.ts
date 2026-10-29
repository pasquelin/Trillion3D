// The compute raster's tiles: the plan the settings make, the sizes it works over, the binning and compaction on their CPU twin, and the text of
// the programs against the bindings the bind groups hold.
import test from 'node:test'
import assert from 'node:assert/strict'
import { binSegments, compactTiles, type BinSegment } from './binnedRaster.fixture.ts'
import { binnedWgsl } from './binnedWgsl.ts'
import { HAIR_RASTER_SLOTS } from './binnedRasterPass.ts'
import {
  HAIR_LIST_ALL,
  HAIR_LIST_HARDWARE,
  HAIR_LIST_SOFTWARE,
  HAIR_RASTER_DEFAULTS,
  HAIR_RASTER_PARAM_WORDS,
  hairRasterGeometry,
  hairRasterPlan,
  hairRasterPlanKey,
  writeHairRasterParams,
} from './rasterModes.ts'
import { HAIR_THREADS_PER_SEGMENT, HAIR_TILE_CHUNK, hairThreadsPerSegment } from './rasterLimits.ts'
import { rasterWgsl } from './rasterWgsl.ts'

const settings = (over: Partial<typeof HAIR_RASTER_DEFAULTS>) => ({
  ...HAIR_RASTER_DEFAULTS,
  ...over,
})

test("the defaults are the reference's and bin the segments into tiles", () => {
  assert.deepEqual(HAIR_RASTER_DEFAULTS, {
    naive: false,
    tileCompaction: false,
    classification: false,
    tileSize: 32,
    maxTiles: 65536,
    numClassifiers: 32,
    numBinners: 32,
    numRasterizers: 256,
    numRasterizersNaive: 256,
  })
  const plan = hairRasterPlan(HAIR_RASTER_DEFAULTS)
  assert.deepEqual(plan, { naive: [], tiles: true, compaction: false, classification: false })
})

test('the plan: naive draws a thread a segment, the classification splits the segments in two', () => {
  assert.deepEqual(hairRasterPlan(settings({ naive: true })).naive, [HAIR_LIST_ALL])
  assert.equal(hairRasterPlan(settings({ naive: true })).tiles, false)
  const split = hairRasterPlan(settings({ classification: true, tileCompaction: true }))
  assert.deepEqual(
    split.naive,
    [HAIR_LIST_HARDWARE],
    'the larger segments by threads, the small ones by tiles',
  )
  assert.ok(split.tiles && split.compaction)
  const both = hairRasterPlan(settings({ classification: true, naive: true, tileCompaction: true }))
  assert.deepEqual(both.naive, [HAIR_LIST_HARDWARE, HAIR_LIST_SOFTWARE])
  assert.ok(!both.tiles && !both.compaction, 'no tile without the tiled raster, so none to compact')
  const keys = new Set(
    [{}, { naive: true }, { classification: true }, { tileCompaction: true }].map((o) =>
      hairRasterPlanKey(hairRasterPlan(settings(o))),
    ),
  )
  assert.equal(keys.size, 4, 'each plan its own programs')
})

test("the geometry holds the settings to the reference's bounds and the device's binding", () => {
  const plan = hairRasterPlan(HAIR_RASTER_DEFAULTS)
  const wide = 1 << 27
  const g = hairRasterGeometry(HAIR_RASTER_DEFAULTS, plan, [1920, 1080], 1000, wide)
  assert.deepEqual([g.tileSize, g.shift, g.cells[0], g.cells[1]], [32, 5, 60, 34])
  assert.equal(g.maxTiles, 65536)
  assert.equal(g.primWords * 4, 65536 * HAIR_TILE_CHUNK * 4)
  assert.equal(g.gridWords, 60 * 34 * (1 + 5 * 32))
  // A tile size is a power of two within 8 to 32; the counts are held to the reference's bounds.
  const odd = hairRasterGeometry(
    settings({ tileSize: 20, maxTiles: 10, numBinners: 999, numRasterizers: 0 }),
    plan,
    [64, 64],
    1,
    wide,
  )
  assert.deepEqual([odd.tileSize, odd.maxTiles, odd.binners, odd.rasterizers], [16, 1024, 256, 1])
  assert.equal(hairRasterGeometry(settings({ tileSize: 1 }), plan, [64, 64], 1, wide).tileSize, 8)
  // A small binding takes the most tiles it holds, and fewer binners than its grid can hold.
  const small = hairRasterGeometry(
    HAIR_RASTER_DEFAULTS,
    plan,
    [1920, 1080],
    1,
    4 * 1024 * HAIR_TILE_CHUNK,
  )
  assert.equal(small.maxTiles, 1024)
  assert.ok(small.gridWords * 4 <= 4 * 1024 * HAIR_TILE_CHUNK)
  // Only the classification keeps a list of the room of the points.
  assert.equal(g.listSize, 1)
  const listed = hairRasterGeometry(
    settings({ classification: true }),
    hairRasterPlan(settings({ classification: true })),
    [64, 64],
    500,
    wide,
  )
  assert.equal(listed.listSize, 500)
  assert.equal(listed.listWords, 502)
})

test("the parameters block holds what the shader's TileParams names, in its order", () => {
  const plan = hairRasterPlan(HAIR_RASTER_DEFAULTS)
  const g = hairRasterGeometry(HAIR_RASTER_DEFAULTS, plan, [1920, 1080], 7, 1 << 27)
  const words = new Uint32Array(HAIR_RASTER_PARAM_WORDS)
  writeHairRasterParams(words, g, plan, [1920, 1080])
  assert.deepEqual([...words], [1920, 1080, 60, 34, 5, 32, 32, 256, 256, 32, 65536, g.listSize])
  const code = binnedWgsl(4, false)
  assert.match(
    code,
    /struct TileParams\{size:vec2u,cells:vec2u,shift:u32,tileSize:u32,binners:u32,rasterizers:u32,rasterizersNaive:u32,classifiers:u32,maxTiles:u32,listSize:u32\}/,
  )
  // Naive draws leave the cells to zero: the clear then has no counter to empty.
  const naive = hairRasterPlan(settings({ naive: true }))
  writeHairRasterParams(words, g, naive, [1920, 1080])
  assert.deepEqual([words[2], words[3]], [0, 0])
})

test('a group shares its threads among the segments of a tile as the reference does, scaled to the chunk', () => {
  // The reference's 1024 threads: 2 up to 512 segments, 3 to 341, ... 8 to 128, 16 to 64, 32 to 32; ours are 256.
  assert.deepEqual(
    [256, 129, 128, 85, 64, 51, 42, 36, 32, 16, 9, 8, 1].map(hairThreadsPerSegment),
    [1, 1, 2, 3, 4, 5, 6, 7, 8, 16, 16, 32, 32],
  )
  for (const count of [1, 7, 31, 100, 256])
    assert.ok(count * hairThreadsPerSegment(count) <= HAIR_TILE_CHUNK)
  const code = binnedWgsl(4, false)
  for (const t of HAIR_THREADS_PER_SEGMENT)
    assert.ok(code.includes(`if(count<=${Math.floor(HAIR_TILE_CHUNK / t)}u){threads=${t}u;}`))
})

/** A pseudo-random generator, so a failure repeats. */
const lcg = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32

/** Whether every segment landed in each cell it reaches exactly once, and nowhere else, in tiles whose counts match their segments. */
function assertBinned(
  segments: readonly BinSegment[],
  tiles: ReturnType<typeof binSegments>,
  cellCount: number,
) {
  const seen = Array.from({ length: cellCount }, () => [] as number[])
  for (const tile of tiles) {
    assert.ok(tile.count <= HAIR_TILE_CHUNK)
    for (let k = 0; k < tile.count; k++) {
      assert.notEqual(tile.prims[k], undefined, 'a counted slot is written')
      seen[tile.cell]!.push(tile.prims[k]!)
    }
  }
  for (let cell = 0; cell < cellCount; cell++) {
    const want = segments
      .filter((s) => s.cells.includes(cell))
      .map((s) => s.id)
      .sort((a, b) => a - b)
    assert.deepEqual(
      seen[cell]!.sort((a, b) => a - b),
      want,
      `cell ${cell}`,
    )
  }
}

test('the binning puts each segment in each cell it reaches, through batches, binners and chunk edges', () => {
  const random = lcg(7)
  const cellCount = 6
  // Many segments over few cells: a cell reaches several chunks, per binner.
  const segments = Array.from({ length: 1500 }, (_, id): BinSegment => ({
    id,
    cells: [
      ...new Set(
        Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
          Math.floor(random() * cellCount),
        ),
      ),
    ],
  }))
  for (const binners of [1, 2, 3, 7])
    assertBinned(segments, binSegments(segments, cellCount, binners, 1 << 20), cellCount)
  // The edges: a batch that fills a cell's chunk exactly, two of them, and a batch that ends one segment past a chunk.
  for (const length of [255, 256, 257, 511, 512, 513, 768])
    for (const binners of [1, 2]) {
      const same = Array.from({ length }, (_, id): BinSegment => ({ id, cells: [0, 1] }))
      assertBinned(same, binSegments(same, 2, binners, 1 << 20), 2)
    }
})

test('a tile past the room is dropped, with the segments bound for it, and nothing else is lost or misplaced', () => {
  const segments = Array.from({ length: 600 }, (_, id): BinSegment => ({ id, cells: [id % 2] }))
  const tiles = binSegments(segments, 2, 1, 2)
  assert.ok(tiles.length <= 2)
  const seen = new Set<number>()
  for (const tile of tiles)
    for (let k = 0; k < tile.count; k++) {
      assert.equal(tile.prims[k]! % 2, tile.cell, 'a segment is in the cell it reaches')
      assert.ok(!seen.has(tile.prims[k]!), 'once')
      seen.add(tile.prims[k]!)
    }
})

test('the compaction merges the tiles of a cell into full ones without losing a segment', () => {
  const random = lcg(11)
  const segments = Array.from({ length: 2000 }, (_, id): BinSegment => ({
    id,
    cells: [Math.floor(random() * 3)],
  }))
  const tiles = binSegments(segments, 3, 5, 1 << 20)
  const compacted = compactTiles(tiles)
  assertBinned(segments, compacted, 3)
  for (const cell of [0, 1, 2]) {
    const mine = compacted.filter((t) => t.cell === cell)
    mine
      .slice(0, -1)
      .forEach((t) => assert.equal(t.count, HAIR_TILE_CHUNK, 'all but the last are full'))
  }
  assert.ok(compacted.length <= tiles.length, 'never more tiles')
})

/** The names of the module-level variables of `code` bound at each binding of group 1. */
function variablesAt(code: string) {
  const at = new Map<number, string>()
  for (const m of code.matchAll(/@group\(1\) @binding\((\d+)\) var(?:<[^>]*>)? (\w+)/g))
    at.set(Number(m[1]), m[2]!)
  return at
}

/** The names of the variables `entry` reaches, through the functions it calls. */
function reached(code: string, entry: string, names: ReadonlySet<string>) {
  const bodies = new Map<string, string>()
  for (const m of code.matchAll(/\bfn (\w+)\(/g)) {
    let depth = 0
    let start = -1
    for (let i = code.indexOf('{', m.index); i < code.length; i++) {
      if (code[i] === '{') {
        if (depth++ === 0) start = i
      } else if (code[i] === '}' && --depth === 0) {
        bodies.set(m[1]!, code.slice(start, i + 1))
        break
      }
    }
  }
  const done = new Set<string>()
  const found = new Set<string>()
  const visit = (fn: string) => {
    if (done.has(fn)) return
    done.add(fn)
    // Without its comments, and a field of a value (inst.ids) is not the variable of its name.
    const body = (bodies.get(fn) ?? '').replace(/\/\/.*$/gm, '')
    for (const name of names) if (new RegExp(`(?<![.\\w])${name}\\b`).test(body)) found.add(name)
    for (const callee of bodies.keys()) if (new RegExp(`\\b${callee}\\(`).test(body)) visit(callee)
  }
  visit(entry)
  return found
}

test('each kernel binds exactly the variables its entry reaches', () => {
  const code = binnedWgsl(4, false)
  const naive = rasterWgsl(4, false)
  const at = variablesAt(code)
  assert.deepEqual(
    [...at.keys()].sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  )
  const names = new Set([...at.values()].filter((n) => !['large', 'largeArgs'].includes(n)))
  const entries = {
    depthGrid: ['hairDepthGrid', code],
    reset: ['hairTileClear', code],
    classify: ['hairClassify', code],
    bin: ['hairBin', code],
    compact: ['hairTileCompact', code],
    tile: ['hairTileRaster', code],
    naive: ['hairRaster', naive],
  } as const
  for (const [kernel, [entry, source]] of Object.entries(entries)) {
    const variables = variablesAt(source)
    const all = new Set([...variables.values()])
    const want = [...reached(source, entry, all)]
      .map((n) => [...variables].find(([, v]) => v === n)![0])
      .sort((a, b) => a - b)
    const slots = [...HAIR_RASTER_SLOTS[kernel as keyof typeof HAIR_RASTER_SLOTS]].sort(
      (a, b) => a - b,
    )
    assert.deepEqual(slots, want, `${kernel} (${entry})`)
  }
  assert.ok(names.size > 0)
})

test('the binning counts, lists, allocates and writes in order, behind barriers, and bins the width of a ribbon', () => {
  const code = binnedWgsl(8, false)
  const bin = code.slice(code.indexOf('fn hairBin('), code.indexOf('var<workgroup> cellTotal'))
  const order = [
    'binRibbon(ribbon,segment,nearest,binner,COUNTED)',
    'let allocated=',
    'binRibbon(ribbon,segment,nearest,binner,WRITTEN)',
  ]
  order.reduce((from, text) => {
    const at = bin.indexOf(text, from)
    assert.ok(at > from, text)
    return at
  }, 0)
  assert.equal(
    bin.split('workgroupBarrier()').length - 1,
    4,
    'a barrier between the phases and before the next batch',
  )
  // The tile is chosen by the counts, whole chunks apart: the segment that crosses is the first of the new tile.
  assert.ok(code.includes('let first=(total-1u)&~(CHUNK-1u);'))
  // The ribbon's two triangles are binned by the cells of each row they span, not by the spine alone.
  assert.ok(
    code.includes('rowSpan(a0,b0,c0,y0,y0+ts)') && code.includes('rowSpan(a1,b1,c1,y0,y0+ts)'),
  )
  assert.ok(!code.includes('DDA'))
  // A cell behind every opaque pixel of its cell is not binned.
  assert.ok(code.includes('if(nearest<atomicLoad(&grid[cell])){return;}'))
  // The cell of a tile takes 16 bits an axis, and the tile past the room is not made.
  assert.ok(code.includes('(cell%tp.cells.x)|((cell/tp.cells.x)<<16u)'))
  assert.ok(code.includes('if(tile<tp.maxTiles){'))
})

test('the shaders use no reserved word and no backtick, and the tile raster clips to its tile', () => {
  for (const code of [binnedWgsl(2, false), binnedWgsl(8, true), rasterWgsl(4, false)]) {
    // The raster's own text (from its constants on), apart from the shared blocks before it.
    assert.ok(!code.slice(code.indexOf('struct TileParams')).includes('`'))
    for (const word of ['meta', 'loop', 'target', 'filter'])
      assert.ok(!new RegExp(`\\b(var|let) ${word}\\b`).test(code), word)
  }
  const raster = binnedWgsl(4, false)
  const kernel = raster.slice(raster.indexOf('fn hairTileRaster('))
  assert.ok(kernel.indexOf('clipBox=') < kernel.indexOf('drawRibbon('))
  assert.ok(kernel.includes('vec2u(lane-prim*share,0u),vec2u(share,1u)'))
  // The fill keeps to the clip box in rows and columns, and an absent clip is the whole image.
  assert.match(rasterWgsl(4, false), /clipBox\.w-1u\)/)
  assert.match(rasterWgsl(4, false), /clipBox\.z-1u\)/)
  assert.match(
    rasterWgsl(4, false),
    /var<private> clipBox:vec4u=vec4u\(0u,0u,0xffffffffu,0xffffffffu\)/,
  )
})
