// The radiance cache's final maps: the filtered probe wrapped into its border, the levels of detail built from the first level, their dither, and where the maps are read and written.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { cacheFilterProgram } from './cache/cacheFilterWgsl.ts'
import { cacheFixupProgram } from './cache/cacheFixupWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { octWrapBorder } from '../../../../math/src/wgsl/octahedral.ts'
import { packLight, unpackLight } from '../../gpu/core/smallFloatWgsl.ts'
import { WORD_LIGHT_FORMAT } from '../../gpu/core/lightAtlasFormat.ts'

const CACHE_FILTER_PROGRAM = cacheFilterProgram(WORD_LIGHT_FORMAT)
const CACHE_FIXUP_PROGRAM = cacheFixupProgram(WORD_LIGHT_FORMAT)

/** The final maps of one probe, in slot zero queued at `entry`, made by the fixup's phases run as a workgroup runs them: every thread of a phase
 *  before the next, a block of texels at a time. The first level is `input(x, y)` over the map, `noise` the hash the dither is given. Returns
 *  what was stored by level, and the places the dither was hashed at. */
function finalMaps(
  resolution: number,
  mipmaps: number,
  input: (x: number, y: number) => number,
  { filtered = true, sky = false, noise = 32768, entry = 0, tempRow = 4 } = {},
) {
  const light = shaderRun<{
    packLight: (c: number[]) => number
    unpackLight: (w: number) => number[]
  }>(wgslModule(packLight, unpackLight), ['packLight', 'unpackLight'], {})
  const word = (x: number, y: number) => [light.packLight([input(x, y), 0, 0]), 0, 0, 0]
  const stored = new Map<string, number>()
  const skyStored = new Map<string, number>()
  const hashed: number[][] = []
  const loaded: number[][] = []
  const level = (n: number) => ({ level: n })
  // Where the filter's atlas puts the probe of rank `entry`: its square, in rows of `tempRow`.
  const temp = [(entry % tempRow) * resolution, Math.floor(entry / tempRow) * resolution]
  const kit = shaderRun<{
    fixupLoad: (entry: number, slot: number, block: number[], local: number[], lane: number) => void
    fixupMipOne: (slot: number, block: number[], local: number[]) => void
    fixupMipTwo: (slot: number, block: number[], local: number[]) => void
  }>(CACHE_FIXUP_PROGRAM, ['fixupLoad', 'fixupMipOne', 'fixupMipTwo'], {
    cache: {
      resolution,
      flags: (filtered ? 1 : 0) | (sky ? 2 : 0),
      mipmaps,
      tempRow,
    },
    bounce: { counts: [48, 1, 110592, 16384], frame: [0, 1, 3, 0] },
    cellTable: {},
    mipLight0: Array.from({ length: 64 }, () => [0, 0, 0]),
    mipLight1: Array.from({ length: 16 }, () => [0, 0, 0]),
    filteredIn: {
      load: (at: number[]) => (loaded.push(at), word(at[0] - temp[0], at[1] - temp[1])),
    },
    cacheRaw: {
      load: (at: number[]) => [word(at[0], at[1])[0], 0xff << 16, 0, 0],
    },
    filteredSkyIn: { load: (at: number[]) => [(at[0] + at[1]) / 100, 0, 0, 0] },
    finalOut0: level(0),
    finalOut1: level(1),
    finalOut2: level(2),
    skyOut: { sky: true },
    textureLoad: (t: { load(at: number[]): number[] }, at: number[]) => t.load(at),
    textureStore: (t: { level?: number; sky?: boolean }, at: number[], v: number[]) =>
      t.sky
        ? void skyStored.set(`${at[0]},${at[1]}`, v[0])
        : void stored.set(`${t.level}:${at[0]},${at[1]}`, light.unpackLight(v[0])[0]),
    rand3dPcg16: (p: number[]) => (hashed.push(p), [noise, 0, 0]),
  })
  const side = resolution + 2 * (1 << (mipmaps - 1))
  const blocks = Math.ceil(side / 8)
  const lanes = (run: (local: number[], lane: number) => void) => {
    for (let lane = 0; lane < 64; lane++) run([lane % 8, Math.floor(lane / 8)], lane)
  }
  for (let by = 0; by < blocks; by++)
    for (let bx = 0; bx < blocks; bx++) {
      lanes((local, lane) => kit.fixupLoad(entry, 0, [bx, by], local, lane))
      if (mipmaps > 1) lanes((local) => kit.fixupMipOne(0, [bx, by], local))
      if (mipmaps > 2) lanes((local) => kit.fixupMipTwo(0, [bx, by], local))
    }
  return { stored, skyStored, hashed, loaded, side }
}

test('the final maps hold what the reference’s atlas holds: the map wrapped into a border of 2^(levels − 1) texels, and each level of detail the means of 2 × 2 texels of the one before, border included, for any side and number of levels', () => {
  const wrap = shaderRun<{
    octWrapBorder: (t: number[], side: number, border: number) => number[]
  }>(wgslModule(octWrapBorder), ['octWrapBorder'], {})
  // Sixteenths from one to two: a mean of four is exact in the 6-bit mantissa of a light, a mean of sixteen is held to half a step of it.
  const first = (x: number, y: number) => 1 + ((x * 7 + y * 13 + x * y) % 17) / 16
  const half = 1 / 128 + 1e-9
  for (const [resolution, mipmaps] of [
    [8, 3],
    [16, 3],
    [16, 2],
    [16, 1],
    [8, 1],
  ] as const) {
    const { stored, side } = finalMaps(resolution, mipmaps, first)
    // The reference's: the border of the first level wrapped at its own width, then each level the 2x2 means of the one before.
    const border = 1 << (mipmaps - 1)
    assert.equal(side, resolution + 2 * border)
    let atlas = Array.from({ length: side }, (_, x) =>
      Array.from({ length: side }, (_, y) => {
        const [i, j] = wrap.octWrapBorder([x, y], side, border)
        return first(i, j)
      }),
    )
    for (let level = 0; level < mipmaps; level++) {
      for (let x = 0; x < side >> level; x++)
        for (let y = 0; y < side >> level; y++)
          assert.ok(
            Math.abs(atlas[x][y] - stored.get(`${level}:${x},${y}`)!) <= half,
            `${resolution} texels, ${mipmaps} levels: level ${level} at ${x},${y}`,
          )
      assert.equal(
        [...stored.keys()].filter((key) => key.startsWith(`${level}:`)).length,
        (side >> level) ** 2,
        `level ${level} is written once a texel, nothing past it`,
      )
      atlas = Array.from({ length: atlas.length >> 1 }, (_, x) =>
        Array.from(
          { length: atlas.length >> 1 },
          (_, y) =>
            (atlas[2 * x][2 * y] +
              atlas[2 * x + 1][2 * y] +
              atlas[2 * x][2 * y + 1] +
              atlas[2 * x + 1][2 * y + 1]) /
            4,
        ),
      )
    }
  }
})

test('a texel of the final maps is dithered by a hash of the input’s place in its atlas and the image’s turn, and a level of detail by a hash of the texel it is written to', () => {
  const packed = shaderRun<{
    packLight: (c: number[]) => number
    unpackLight: (w: number) => number[]
  }>(wgslModule(packLight, unpackLight), ['packLight', 'unpackLight'], {})
  const pack = (c: number) => packed.unpackLight(packed.packLight([c, 0, 0]))[0]
  // The third level of a map of 16 texels with three levels, its texel (2, 2): the mean of the 4 × 4 texels of the first level from (8, 8) of the
  // bordered map, which are (4, 4) to (7, 7) of the map itself (the border is four texels). Sixteen texels of 7.5, three of them 7.5625 (the next
  // a 6-bit mantissa holds): a mean a fifth of a step above 7.5.
  const uneven = (x: number, y: number) =>
    x - 4 + 4 * (y - 4) < 3 && x >= 4 && y >= 4 && x < 8 && y < 8 ? 7.5625 : 7.5
  const level = (noise: number) => finalMaps(16, 3, uneven, { noise }).stored.get('2:2,2')
  assert.equal(level(65535), pack(7.5625), 'dithered up')
  assert.equal(level(0), pack(7.5), 'dithered down')
  // The place hashed is the input's, in the atlas it is read from, with the image's turn: the first texel of a probe whose map the filter wrote
  // at the square of rank 5 in rows of 4 is the mirror of the corner in the border, in that square.
  const wrap = shaderRun<{
    octWrapBorder: (t: number[], side: number, border: number) => number[]
  }>(wgslModule(octWrapBorder), ['octWrapBorder'], {})
  const { hashed } = finalMaps(8, 2, uneven, { entry: 5, tempRow: 4 })
  const [x, y] = wrap.octWrapBorder([0, 0], 12, 2)
  assert.deepEqual(hashed[0], [8 + x, 8 + y, 3])
})

test('the final maps are read from the filter’s atlas at the probe’s rank in the queue where the filter runs, else from the raw atlas at its slot, the sky’s share from the filter’s or from the raw word', () => {
  const first = (x: number, y: number) => 1 + ((x + y) % 4) / 16
  const filtered = finalMaps(8, 1, first, { sky: true, entry: 5, tempRow: 4 })
  assert.ok(
    filtered.loaded.every(([x, y]) => x >= 8 && x < 16 && y >= 8 && y < 16),
    'the square of rank 5 in rows of 4: one right, one down',
  )
  assert.equal(
    filtered.skyStored.size,
    filtered.side ** 2,
    'the sky’s share, bordered, the first level alone',
  )
  const raw = finalMaps(8, 1, first, { sky: true, filtered: false })
  assert.equal(raw.loaded.length, 0, 'the filter’s atlas is not read')
  assert.equal(raw.skyStored.get('0,0'), 1, 'the raw word’s share, all ones: one')
  assert.equal(
    finalMaps(8, 1, first, { filtered: false }).skyStored.size,
    0,
    'no sky kept apart: none',
  )
})

test('the filter writes its probe’s texels into its own atlas at the probe’s rank in the queue, the final atlas left to the fixup, and runs only where the setting asks', () => {
  assert.match(CACHE_FILTER_PROGRAM, /let outBase=cacheTempTileOf\(entry,res,cache\.tempRow\);/)
  assert.match(CACHE_FILTER_PROGRAM, /textureStore\(filteredOut,vec2i\(outBase\+texel\)/)
  assert.doesNotMatch(CACHE_FILTER_PROGRAM, /finalOut|CACHE_FLAG_FILTER/)
})
