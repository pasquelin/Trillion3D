// A point of light read through the radiance pyramid's chain at a coarse level
// (`reflectionRadianceAt`, a cubic B-spline of the level's texels) is a round blob where the point
// is, where a 2×2 box chain read bilinearly makes it a diamond or a square, moved to its coarse
// texel.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { reflectedRadianceWgsl } from './wgsl.ts'
import { bilinear, image, radianceKernels } from './radianceKernels.fixture.ts'

test('a point of light read through the chain at a coarse level is round, never a square', () => {
  const k = radianceKernels([256, 256, 0, 0])
  const levels = [image(256, 256, (x, y) => (x === 128 && y === 128 ? [1, 0, 0, 0] : [0, 0, 0, 0]))]
  for (let n = 0; n < 3; n++) {
    const { coarser, coarsest } = k.down(levels.at(-1)!)
    levels.push(coarser, coarsest)
  }
  // The lit image, level 0, and the coarse levels, level `k` at their mip `k − 1`.
  const radiance = {},
    lit = {}
  const levelOf = (t: unknown, lod: number) => (t === lit ? 0 : lod + 1)
  type Taps = { color: number[]; weight: number }
  const { reflectionRadianceAt } = shaderRun<{
    reflectionRadianceAt: (
      sum: { get: () => Taps; set: (v: Taps) => void },
      uv: number[],
      level: number,
      share: number,
      toView: number[],
      surface: object,
    ) => void
  }>(
    wgslModule(reflectedRadianceWgsl(1, { group: 0, proxy: 20, worlds: 21 })),
    ['reflectionRadianceAt', 'reflectionLevelRead', 'reflectionLevelColor'],
    {
      reflectionRadiance: radiance,
      reflectionImage: lit,
      reflectionSampler: {},
      // Every tap on the hit's surface: the chain alone.
      reflectionDepthWeight: () => 1,
      textureDimensions: (t: unknown, lod = 0) => {
        const level = levels[levelOf(t, lod)]
        return [level.width, level.height]
      },
      textureSampleLevel: (t: unknown, __: unknown, uv: number[], lod: number) =>
        bilinear(levels[levelOf(t, lod)], uv),
    },
  )
  // The point's centre, in pixels: 128.5, where the blob stays centred at every level — a box
  // chain moves it to its coarse texel's centre, 7.5 pixels off at level 4. Where it falls to a
  // half and to a tenth of its peak — the edge the eye sees —, the same radius along an axis and
  // along a diagonal within a tenth, at an integer level and between two: the box chain's half is a
  // diamond, 0.83 of it across, its tenth a square.
  const at = (x: number, y: number, level: number) => {
    let taps: Taps = { color: [0, 0, 0, 0], weight: 0 }
    const sum = { get: () => taps, set: (v: Taps) => void (taps = v) }
    reflectionRadianceAt(sum, [x / 256, y / 256], level, 1, [0, 0, 256, 256], {})
    return taps.color[0]
  }
  const reach = (level: number, share: number, dx: number, dy: number) => {
    const peak = at(128.5, 128.5, level)
    let near = 0,
      far = 4 * 2 ** level
    for (let k = 0; k < 40; k++) {
      const r = (near + far) / 2
      if (at(128.5 + r * dx, 128.5 + r * dy, level) > share * peak) near = r
      else far = r
    }
    return near
  }
  for (const level of [2, 3, 3.5, 4])
    for (const share of [0.5, 0.1]) {
      const along = reach(level, share, 1, 0),
        diagonal = reach(level, share, Math.SQRT1_2, Math.SQRT1_2)
      assert.ok(Math.abs(diagonal / along - 1) < 0.1, `${level}, ${share}: ${along}, ${diagonal}`)
    }
  // Its centroid along a row through it, where the point is.
  for (const level of [3, 4]) {
    let mass = 0,
      moment = 0
    for (let x = 64; x < 192; x += 0.25) {
      const v = at(x, 128.5, level)
      mass += v
      moment += v * x
    }
    assert.ok(Math.abs(moment / mass - 128.5) < 0.5, `${level}: ${moment / mass}`)
  }
})
