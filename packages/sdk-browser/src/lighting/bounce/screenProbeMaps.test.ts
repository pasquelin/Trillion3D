// The screen probes' maps and words as the shaders run them: the equal-area map of the sphere, a ray's end word,
// a hit’s gap in device depth.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spHistoryDepth } from './screen/historyWgsl.ts'
import { spCommon } from './screen/commonWgsl.ts'
import { spProbeRecords, spProbeWord, spSurface } from './screen/probesWgsl.ts'
import {
  equalAreaDecode,
  equalAreaEncode,
  octWrapBorder,
} from '../../../../math/src/wgsl/octahedral.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'

test('the equal-area map of the sphere and its inverse agree, and the octahedron border wraps to a texel inside', () => {
  const map = shaderRun<{
    equalAreaDecode: (uv: number[]) => number[]
    equalAreaEncode: (direction: number[]) => number[]
    octWrapBorder: (texel: number[], resolution: number, border: number) => number[]
  }>(
    wgslModule(equalAreaDecode, equalAreaEncode, octWrapBorder),
    ['equalAreaDecode', 'equalAreaEncode', 'octWrapBorder'],
    {},
  )
  for (let i = 1; i < 16; i += 2) {
    for (let j = 1; j < 16; j += 2) {
      const uv = [i / 16, j / 16]
      const direction = map.equalAreaDecode(uv)
      assert.ok(Math.abs(Math.hypot(...direction) - 1) < 1e-5, 'a unit direction')
      const back = map.equalAreaEncode(direction)
      assert.ok(
        Math.abs(back[0] - uv[0]) < 1e-4 && Math.abs(back[1] - uv[1]) < 1e-4,
        `${uv} -> ${back}`,
      )
    }
  }
  // Eight texels and a border of one: a border texel is the texel of the map across the edge, the other axis
  // flipped, its coordinates inside the map (the border removed).
  for (const [texel, inside] of [
    [
      [0, 4],
      [0, 4],
    ],
    [
      [9, 2],
      [7, 6],
    ],
    [
      [4, 0],
      [4, 0],
    ],
    [
      [4, 9],
      [4, 7],
    ],
    [
      [3, 3],
      [2, 2],
    ],
  ] as const)
    assert.deepEqual(map.octWrapBorder([...texel], 10, 1), [...inside], `${texel}`)
})

test("a ray's end word keeps its distance to a few millionths, and whether what it met moves", () => {
  const word = shaderRun<{
    spHitWord: (distance: number, moving: boolean) => number
    spHitDistance: (word: number) => number
    spHitMoves: (word: number) => boolean
  }>(wgslModule(spCommon([4, 2])), ['spHitWord', 'spHitDistance', 'spHitMoves'], {})
  for (const [distance, moving] of [
    [0, false],
    [12.5, false],
    [199.99, true],
    [3.3, true],
  ] as const) {
    const packed = word.spHitWord(distance, moving)
    assert.ok(Math.abs(word.spHitDistance(packed) - distance) <= distance * 4e-7, `${distance}`)
    assert.equal(word.spHitMoves(packed), moving)
  }
  assert.equal(word.spHitDistance(word.spHitWord(-5, true)), 0, 'a distance is never negative')
})

test('a hit of the screen trace is kept by its gap in device depth, as the depth buffer holds it: a distance does not loosen the test a relative one would', () => {
  const { spDeviceGap: gap } = shaderRun<{
    spDeviceGap: (kept: number, expected: number[]) => number
  }>(wgslModule(spHistoryDepth(7)), ['spDeviceGap'], {})
  // The point is expected at the clip position `[x, y, z, w]`, its device depth `z / w`; the gap is the plain difference of the two.
  assert.ok(Math.abs(gap(0.3, [0, 0, 1, 2]) - 0.2) < 1e-6)
  // A perspective: the device depth is B / w. At 100 m a metre apart is a gap of a hundredth of the threshold; the relative test (a half
  // to one and a half of an eighth of a percent of the depth at a metre in a hundred) would have refused it.
  const B = 0.1
  assert.ok(gap(B / 100, [0, 0, B, 101]) < 0.005 / 100)
  assert.ok(Math.abs(gap(B / 100, [0, 0, B, 101]) - B * (1 / 100 - 1 / 101)) < 1e-9)
  assert.ok(
    gap(0, [0, 0, 0.2, 1]) >= 1e30,
    'a texel that kept no surface holds no depth: it matches nothing',
  )
})

test("a probe's word keeps its normal as an 8-bit normalised octahedral pair rounds it, its speed as a half float and whether it has backface diffuse light or is hair in the speed's sign and last bit", () => {
  const probe = shaderRun<{
    spProbeWord: (normal: number[], speed: number, foliage: boolean, hair: boolean) => number
    spProbeNormal: (word: number) => number[]
    spProbeSpeed: (word: number) => number
  }>(
    wgslModule(spProbeWord, spProbeRecords(1, 2)),
    ['spProbeWord', 'spProbeNormal', 'spProbeSpeed'],
    {},
  )
  const word = (normal: number[], speed: number, foliage = false, hair = false) =>
    probe.spProbeWord(normal, speed, foliage, hair) >>> 0
  // (0, 0, 1) lies at the octahedron's middle: 0.5 · 255 + 0.5 is 128, on each byte; the speed 1.5 is 0x3e00 in half floats.
  assert.equal(word([0, 0, 1], 1.5), ((0x3e00 << 16) | (128 << 8) | 128) >>> 0)
  // (1, 0, 0) lies at the square's edge, x on 255 and y on the middle; (0, 0, -1) is the corner, folded to (1, 1).
  assert.equal(word([1, 0, 0], 0), (128 << 8) | 255)
  assert.equal(word([0, 0, -1], 0), (255 << 8) | 255)
  assert.equal(probe.spProbeSpeed(word([0, 0, 1], 1.5)), 1.5)
  // The kind: the sign bit of the speed half for backface diffuse light, the last bit of its mantissa for hair, neither changing the speed or the normal.
  assert.equal(word([0, 0, 1], 1.5, true), (word([0, 0, 1], 1.5) | 0x80000000) >>> 0)
  assert.equal(word([0, 0, 1], 1.5, false, true), (word([0, 0, 1], 1.5) | 0x10000) >>> 0)
  assert.equal(probe.spProbeSpeed(word([0, 0, 1], 1.5, true, true)), 1.5)
  assert.deepEqual(
    probe.spProbeNormal(word([0, 0, 1], 1.5, true, true)),
    probe.spProbeNormal(word([0, 0, 1], 1.5)),
  )
  // Both halves of the sphere come back unit, within the 8:8 octahedral map's worst angle (0.94 degrees).
  for (const normal of [
    [0.6, 0.0, 0.8],
    [-0.36, 0.48, 0.8],
    [0.48, -0.6, -0.64],
    [-0.3, -0.5, -Math.sqrt(0.66)],
  ]) {
    const back = probe.spProbeNormal(word(normal, 2))
    assert.ok(Math.abs(Math.hypot(...back) - 1) < 1e-5, `a unit normal ${normal}`)
    const dot = back[0] * normal[0] + back[1] * normal[1] + back[2] * normal[2]
    assert.ok(dot > Math.cos(0.0165), `${normal} -> ${back}: ${dot}`)
  }
})

test('a pixel lit through its back is a thin double-sided sheet or a subsurface surface, whatever its colour', () => {
  const code = wgslModule(spSurface(0, 1))
  assert.match(code, /let foliage=\(flags&\d+u\)!=0u\|\|pixelModelOf\(flags\)==\d+u;/)
})
