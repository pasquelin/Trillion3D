// The screen probes' maps and words as the shaders run them: the equal-area map of the sphere, a ray's end word,
// a hit’s gap in device depth.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spHistoryDepth } from './screen/historyWgsl.ts'
import { spCommon } from './screen/commonWgsl.ts'
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
