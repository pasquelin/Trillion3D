// The radiance pyramid's shipped kernels (`RADIANCE_SHADER`) run as JavaScript: the first copies
// the drawn image into level 0 and filters level 1 from its tile, as the second filters every
// further level — the separable tent [1, 3, 3, 1] / 8, which keeps the image's energy — and a point
// of light read through the chain at a coarse level (`reflectionRadianceAt`, a cubic B-spline of
// the level's texels) is a round blob where the point is, where a 2×2 box chain read bilinearly
// makes it a diamond or a square, moved to its coarse texel.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { RADIANCE_SHADER } from './gpu.ts'
import { reflectedRadianceWgsl } from './wgsl.ts'

type Image = { width: number; height: number; texels: number[][] }
const image = (width: number, height: number, at: (x: number, y: number) => number[]): Image => ({
  width,
  height,
  texels: Array.from({ length: width * height }, (_, i) => at(i % width, Math.floor(i / width))),
})

/** The shipped kernels over `finer` into `coarser` (and `copy`), `drawn` the image's drawn size. */
function kernels(drawn: number[]) {
  const binding = { finer: {}, coarser: {}, copy: {} }
  const io = {
    finer: image(1, 1, () => [0, 0, 0, 0]),
    coarser: image(1, 1, () => [0, 0, 0, 0]),
    copy: image(1, 1, () => [0, 0, 0, 0]),
  }
  const tile: number[][] = []
  const of = (t: object) =>
    t === binding.finer ? io.finer : t === binding.coarser ? io.coarser : io.copy
  const run = shaderRun<{
    radianceFirst: (group: number[], local: number[], index: number) => void
    radianceDown: (id: number[]) => void
  }>(RADIANCE_SHADER, ['radianceFirst', 'radianceDown', 'radianceAt', 'tent'], {
    ...binding,
    drawn,
    tile,
    workgroupBarrier: () => {},
    textureDimensions: (t: object) => [of(t).width, of(t).height],
    textureLoad: (t: object, p: number[]) => of(t).texels[p[1] * of(t).width + p[0]],
    textureStore: (t: object, p: number[], value: number[]) => {
      of(t).texels[p[1] * of(t).width + p[0]] = value
    },
  })
  return {
    io,
    /** `radianceFirst` over every workgroup: each thread once to fill the tile, then once more,
     *  the tile whole, as the barrier orders them. */
    first(source: Image) {
      io.finer = source
      io.copy = image(source.width, source.height, () => [0, 0, 0, 0])
      io.coarser = image(source.width >> 1, source.height >> 1, () => [0, 0, 0, 0])
      for (let gy = 0; gy < Math.ceil(source.height / 16); gy++)
        for (let gx = 0; gx < Math.ceil(source.width / 16); gx++)
          for (const _ of [0, 1])
            for (let index = 0; index < 256; index++)
              run.radianceFirst([gx, gy, 0], [index % 16, Math.floor(index / 16), 0], index)
      return { copy: io.copy, level: io.coarser }
    },
    down(source: Image) {
      io.finer = source
      io.coarser = image(Math.max(1, source.width >> 1), Math.max(1, source.height >> 1), () => [
        0, 0, 0, 0,
      ])
      for (let y = 0; y < io.coarser.height; y++)
        for (let x = 0; x < io.coarser.width; x++) run.radianceDown([x, y, 0])
      return io.coarser
    },
  }
}

const sum = (img: Image) => img.texels.reduce((s, t) => s.map((v, c) => v + t[c]), [0, 0, 0, 0])
const close = (a: number[], b: number[], tolerance: number) =>
  a.every((v, c) => Math.abs(v - b[c]) <= tolerance * Math.max(1, Math.abs(b[c])))

test('the first kernel copies the drawn image, and filters level 1 as every further level is', () => {
  // An image larger than its drawn part, its coverage past 1 where a blend over-covers.
  const source = image(40, 36, (x, y) => [x * 0.1, y * 0.05, (x * y) % 7, x < 30 ? 1.5 : 0.5])
  const drawn = [34, 30, 0, 0]
  const k = kernels(drawn)
  const { copy, level } = k.first(source)
  for (let y = 0; y < 36; y++)
    for (let x = 0; x < 40; x++) {
      const inside = x < 34 && y < 30
      const expected = inside
        ? [...source.texels[y * 40 + x].slice(0, 3), Math.min(source.texels[y * 40 + x][3], 1)]
        : [0, 0, 0, 0]
      assert.deepEqual(copy.texels[y * 40 + x], expected, `${x},${y}`)
    }
  const again = k.down(copy)
  for (let i = 0; i < level.texels.length; i++)
    assert.ok(close(level.texels[i], again.texels[i], 1e-12), `level 1 texel ${i}`)
})

test('a level keeps the energy of the one before it, through a separable symmetric tent', () => {
  const k = kernels([64, 64, 0, 0])
  // Light away from the border, so that no weight falls outside.
  const source = image(64, 64, (x, y) =>
    x > 4 && x < 58 && y > 4 && y < 58 ? [Math.sin(x) + 1.5, (x + y) % 5, 1, 1] : [0, 0, 0, 0],
  )
  const coarse = k.down(source)
  assert.ok(
    close(
      sum(coarse).map((v) => 4 * v),
      sum(source),
      1e-12,
    ),
  )
  // One point: the outer product of [3, 1] / 8 and its mirror, the same on both axes.
  const point = image(16, 16, (x, y) => (x === 8 && y === 8 ? [64, 0, 0, 0] : [0, 0, 0, 0]))
  const blob = k.down(point)
  const at = (x: number, y: number) => blob.texels[y * 8 + x][0]
  assert.equal(at(4, 4), 9)
  assert.equal(at(3, 4), 3)
  assert.equal(at(4, 3), 3)
  assert.equal(at(3, 3), 1)
  assert.equal(sum(blob)[0], 16)
})

test('a point of light read through the chain at a coarse level is round, never a square', () => {
  const k = kernels([256, 256, 0, 0])
  const levels = [image(256, 256, (x, y) => (x === 128 && y === 128 ? [1, 0, 0, 0] : [0, 0, 0, 0]))]
  for (let n = 0; n < 5; n++) levels.push(k.down(levels[n]))
  /** A level's bilinear read at `uv`, as the sampler reads it, its edge clamped. */
  const bilinear = (level: Image, uv: number[]) => {
    const u = uv[0] * level.width - 0.5,
      v = uv[1] * level.height - 0.5
    const x0 = Math.floor(u),
      y0 = Math.floor(v),
      fx = u - x0,
      fy = v - y0
    const texel = (i: number, j: number) =>
      level.texels[
        Math.min(Math.max(j, 0), level.height - 1) * level.width +
          Math.min(Math.max(i, 0), level.width - 1)
      ][0]
    return (
      (1 - fy) * ((1 - fx) * texel(x0, y0) + fx * texel(x0 + 1, y0)) +
      fy * ((1 - fx) * texel(x0, y0 + 1) + fx * texel(x0 + 1, y0 + 1))
    )
  }
  const radiance = {}
  const { reflectionRadianceAt } = shaderRun<{
    reflectionRadianceAt: (uv: number[], level: number) => number[]
  }>(wgslModule(reflectedRadianceWgsl(1)), ['reflectionRadianceAt', 'reflectionLevelRead'], {
    reflectionRadiance: radiance,
    reflectionSampler: {},
    textureDimensions: (_: unknown, level: number) => [levels[level].width, levels[level].height],
    textureSampleLevel: (_: unknown, __: unknown, uv: number[], level: number) => [
      bilinear(levels[level], uv),
      0,
      0,
      0,
    ],
  })
  // The point's centre, in pixels: 128.5, where the blob stays centred at every level — a box
  // chain moves it to its coarse texel's centre, 7.5 pixels off at level 4. Where it falls to a
  // half and to a tenth of its peak — the edge the eye sees —, the same radius along an axis and
  // along a diagonal within a tenth, at an integer level and between two: the box chain's half is a
  // diamond, 0.83 of it across, its tenth a square.
  const at = (x: number, y: number, level: number) =>
    reflectionRadianceAt([x / 256, y / 256], level)[0]
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
