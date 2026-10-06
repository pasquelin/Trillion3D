// The early-exit verdict against its definition: the oracle's farthest footprint depth, then
// `hizOccluded`, on pyramids holding +Infinity, NaN, -Infinity and signed zeros.
import test from 'node:test'
import assert from 'node:assert/strict'
import { hizBuildFlat } from '../../../sdk-core/src/index.ts'
import { hizFootprintFarFlat, hizOccluded } from '../../../sdk-core/src/hiz/oracles.fixture.ts'
import { hizHides } from './hides.ts'

const reference = (
  pyramid: ReturnType<typeof hizBuildFlat>,
  level: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  nearest: number,
  bias: number,
) => hizOccluded(nearest, hizFootprintFarFlat(pyramid, x0, y0, x1 + 1, y1 + 1, level), bias)

test('a footprint all +Infinity hides nothing, even when its coarse level is finite', () => {
  // Texels 1..3 of rows 1..3 are +Infinity; the level-1 texels over them also cover finite ones.
  const depth = new Float32Array(64).fill(0.9)
  for (let y = 1; y <= 3; y++) depth.fill(Infinity, y * 8 + 1, y * 8 + 4)
  const pyramid = hizBuildFlat(depth, 8, 8)
  assert.equal(reference(pyramid, 0, 1, 1, 3, 3, 0.1, 0), false)
  assert.equal(hizHides(pyramid, 0, 1, 1, 3, 3, 0.1), false)
  assert.equal(hizHides(pyramid, 0, 0, 0, 3, 3, 0.1), true)
})

test('the verdict equals hizOccluded over the farthest footprint depth on hostile pyramids', () => {
  let s = 7
  const next = () => ((s ^= s << 13), (s ^= s >>> 17), (s ^= s << 5), (s >>> 0) / 4294967296)
  const special = [Infinity, NaN, -Infinity, 0, -0, 0.45]
  for (const [width, height] of [
    [1, 1],
    [7, 3],
    [33, 17],
    [160, 90],
  ]) {
    const depth = new Float32Array(width * height)
    for (let i = 0; i < depth.length; i++)
      depth[i] = next() < 0.1 ? special[Math.floor(next() * special.length)] : 0.4 + 0.6 * next()
    const pyramid = hizBuildFlat(depth, width, height)
    for (let i = 0; i < 20000; i++) {
      const level = Math.floor(next() * pyramid.count),
        x0 = Math.floor(next() * width),
        y0 = Math.floor(next() * height),
        x1 = Math.min(width - 1, x0 + Math.floor(next() * 16 * 2 ** level)),
        y1 = Math.min(height - 1, y0 + Math.floor(next() * 16 * 2 ** level)),
        nearest = next() < 0.02 ? special[i % special.length] : next() * 0.6,
        bias = [0, -0, 1e-3, 0.05, -1e-3, NaN][i % 6]
      const expected = reference(pyramid, level, x0, y0, x1, y1, nearest, bias)
      if (hizHides(pyramid, level, x0, y0, x1, y1, nearest, bias) !== expected)
        assert.fail(
          `${width}x${height} level ${level} [${x0},${y0}]-[${x1},${y1}] ${nearest} ${bias}`,
        )
    }
  }
})
