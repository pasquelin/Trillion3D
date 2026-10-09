// The reflection's shipped WGSL run as JavaScript (`shaderRun`): the cone's half-angle and the
// radiance level its footprint reads, the fades that blend the screen into the environment, the
// lobe's zonal moments, and the hierarchical march on synthetic depth pyramids — a hit where the
// depth stands, none through a gap, none through a depth thinner than a pixel, a miss past it all.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import {
  REFLECTION_CONE_WGSL,
  REFLECTION_EDGE,
  REFLECTION_ENVIRONMENT_WGSL,
  REFLECTION_FADE_ROUGHNESS,
  REFLECTION_MARCH_WGSL,
  REFLECTION_STEPS,
  REFLECTION_THICKNESS,
  REFLECTION_TRACE_ROUGHNESS,
  REFLECTION_VIEW_BYTES,
  reflectedRadianceWgsl,
} from './wgsl.ts'
import { writeReflectionView, type ScreenReflection } from './gpu.ts'

type Cone = {
  reflectionConeTangent: (rough: number) => number
  reflectionConeLevel: (distance: number, cone: number, pixel: number, top: number) => number
  reflectionEdgeFade: (pixel: number[], size: number[]) => number
  reflectionThicknessFade: (gap: number, span: number) => number
  reflectionTraceWeight: (rough: number) => number
}
const cone = shaderRun<Cone>(
  wgslModule(REFLECTION_CONE_WGSL),
  [
    'reflectionConeTangent',
    'reflectionConeLevel',
    'reflectionEdgeFade',
    'reflectionThicknessFade',
    'reflectionTraceWeight',
  ],
  {},
)

test('the cone is closed on a mirror and opens with roughness, as the GGX lobe at half its peak', () => {
  assert.equal(cone.reflectionConeTangent(0), 0)
  // Wider at every roughness, until the half-vector's angle reaches its 40° bound.
  let last = 0
  for (let rough = 0.05; rough <= 1; rough += 0.05) {
    const tangent = cone.reflectionConeTangent(rough)
    assert.ok(rough > 0.8 ? tangent >= last : tangent > last, `wider at ${rough}`)
    last = tangent
  }
  // Small α: the half-vector's half-maximum angle is α√(√2 − 1), the reflected cone's twice it.
  const rough = 0.1,
    alpha = rough * rough
  const expected = 2 * alpha * Math.sqrt(Math.SQRT2 - 1)
  assert.ok(Math.abs(cone.reflectionConeTangent(rough) / expected - 1) < 1e-3)
  // Bounded: the half-vector's angle never passes 40°.
  assert.ok(Number.isFinite(cone.reflectionConeTangent(1)))
})

test('the radiance level is log2 of the cone footprint in pixels, one more per doubled distance', () => {
  const pixel = 0.01,
    top = 10
  // Footprint 2·d·tan: 1 pixel and below is level 0, the sharp image.
  assert.equal(cone.reflectionConeLevel(1, 0, pixel, top), 0)
  assert.equal(cone.reflectionConeLevel(0.005, 1, pixel, top), 0)
  assert.equal(cone.reflectionConeLevel(1, 0.25, 0.0625, top), 3)
  for (const distance of [0.3, 1, 4]) {
    const near = cone.reflectionConeLevel(distance, 0.1, pixel, top)
    const far = cone.reflectionConeLevel(2 * distance, 0.1, pixel, top)
    assert.ok(Math.abs(far - near - 1) < 1e-9, 'contact hardening: twice as far, one level up')
  }
  // Fractional between levels, clamped at the top.
  const level = cone.reflectionConeLevel(1, 0.03, pixel, top)
  assert.ok(level > 2 && level < 3)
  assert.equal(cone.reflectionConeLevel(1e6, 1, pixel, top), top)
})

test('a hit fades into the environment at the image edge, smoothly and only there', () => {
  const size = [320, 200],
    border = REFLECTION_EDGE * size[1]
  assert.equal(cone.reflectionEdgeFade([160, 100], size), 1)
  assert.equal(cone.reflectionEdgeFade([border, border], size), 1)
  for (const at of [
    [0, 100],
    [320, 100],
    [160, 0],
    [160, 200],
  ])
    assert.equal(cone.reflectionEdgeFade(at, size), 0)
  let last = 0
  for (let x = 0; x <= border; x += border / 64) {
    const fade = cone.reflectionEdgeFade([x, 100], size)
    assert.ok(fade >= last && fade - last < 0.05, 'no step')
    last = fade
  }
  // Symmetric.
  assert.equal(cone.reflectionEdgeFade([3, 100], size), cone.reflectionEdgeFade([317, 100], size))
})

test('a ray that passes behind a depth fades out over the thickness, smoothly', () => {
  const span = 64,
    thickness = REFLECTION_THICKNESS * span
  assert.equal(cone.reflectionThicknessFade(0, span), 1)
  assert.equal(cone.reflectionThicknessFade(0.5 * thickness, span), 1)
  assert.equal(cone.reflectionThicknessFade(thickness, span), 0)
  assert.equal(cone.reflectionThicknessFade(10 * thickness, span), 0)
  const mid = cone.reflectionThicknessFade(0.75 * thickness, span)
  assert.ok(Math.abs(mid - 0.5) < 1e-9)
})

test('the screen gives way to the environment over the trace roughness range', () => {
  assert.equal(cone.reflectionTraceWeight(0), 1)
  assert.equal(cone.reflectionTraceWeight(REFLECTION_FADE_ROUGHNESS), 1)
  assert.equal(cone.reflectionTraceWeight(REFLECTION_TRACE_ROUGHNESS), 0)
  assert.equal(cone.reflectionTraceWeight(1), 0)
  // Halfway, half: the bounds are the f32 the shader reads.
  const mid = cone.reflectionTraceWeight(
    (REFLECTION_FADE_ROUGHNESS + REFLECTION_TRACE_ROUGHNESS) / 2,
  )
  assert.ok(Math.abs(mid - 0.5) < 1e-6)
})

test('the GGX lobe keeps a mirror whole and filters the higher bands as it roughens', () => {
  const { reflectionBands } = shaderRun<{ reflectionBands: (rough: number) => number[] }>(
    wgslModule(REFLECTION_ENVIRONMENT_WGSL),
    ['reflectionBands'],
    {},
  )
  const mirror = reflectionBands(0.0525)
  assert.equal(mirror[0], 1)
  assert.ok(mirror[1] > 0.999 && mirror[2] > 0.999)
  let last = mirror
  for (const rough of [0.2, 0.4, 0.6, 0.8, 1]) {
    const bands = reflectionBands(rough)
    assert.equal(bands[0], 1)
    assert.ok(bands[1] < last[1] && bands[2] < last[2], `filtered more at ${rough}`)
    assert.ok(bands[2] < bands[1], 'the quadratic band filtered more than the linear one')
    last = bands
  }
})

/** A depth pyramid as the nearest levels build it (`nearestMips.ts`): level 0 `depth`,
 *  each level the maximum of the texels it covers, the last texel of an odd size covering the
 *  source's last column or row. */
function pyramid(width: number, height: number, depth: (x: number, y: number) => number) {
  const levels = [{ width, height, at: (x: number, y: number) => depth(x, y) }]
  while (levels.at(-1)!.width > 1 || levels.at(-1)!.height > 1) {
    const finer = levels.at(-1)!
    const w = Math.max(1, finer.width >> 1),
      h = Math.max(1, finer.height >> 1)
    const texels = new Float64Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const hx = x === w - 1 ? finer.width - 1 : 2 * x + 1,
          hy = y === h - 1 ? finer.height - 1 : 2 * y + 1
        let near = 0
        for (let v = 2 * y; v <= hy; v++)
          for (let u = 2 * x; u <= hx; u++) near = Math.max(near, finer.at(u, v))
        texels[y * w + x] = near
      }
    levels.push({ width: w, height: h, at: (x, y) => texels[y * w + x] })
  }
  return levels
}

type March = {
  reflectionMarch: (o: number[], d: number[], end: number) => number
  reflectionScreenEnd: (o: number[], d: number[], size: number[]) => number
}
/** The shipped march over the pyramid of `depth`, `width × height`. */
function marcher(width: number, height: number, depth: (x: number, y: number) => number) {
  const levels = pyramid(width, height, depth)
  let loads = 0
  const run = shaderRun<March>(
    wgslModule(REFLECTION_MARCH_WGSL),
    ['reflectionMarch', 'reflectionScreenEnd', 'reflectionNearest'],
    {
      // The Hi-Z level 0, and the nearest levels below it, mip k holding level k + 1.
      reflectionDepth: { below: 0 },
      reflectionNearestMips: { below: 1 },
      textureNumLevels: () => levels.length - 1,
      textureDimensions: ({ below }: { below: number }, level = 0) => {
        const { width: w, height: h } = levels[level + below]
        return [w, h]
      },
      textureLoad: ({ below }: { below: number }, cell: number[], level: number) => (
        loads++,
        [levels[level + below].at(cell[0], cell[1])]
      ),
    },
  )
  const size = [width, height]
  return {
    /** Where the ray from `o` along `d` stops on the screen, or undefined: a miss. */
    hit(o: number[], d: number[]) {
      loads = 0
      const t = run.reflectionMarch(
        o,
        d,
        run.reflectionScreenEnd(o.slice(0, 2), d.slice(0, 2), size),
      )
      return { at: t < 0 ? undefined : o.map((x, k) => x + d[k] * t), loads }
    },
  }
}

// Reversed depth: 1 at the near plane, 0 at infinity. The background reads 0.
const W = 128,
  H = 64

test('a ray stops at the first depth in front of it, its own pixel never', () => {
  // A wall one pixel wide at x = 80, nearer than the ray, over a far floor.
  const march = marcher(W, H, (x) => (x === 80 ? 0.8 : 0.1))
  // Across the screen at a constant depth of 0.5: in front of the floor, behind the wall.
  const { at, loads } = march.hit([20.5, 30.5, 0.5], [100, 0, 0])
  assert.ok(at, 'hit')
  assert.ok(at[0] >= 80 && at[0] < 81, `on the wall's pixel: ${at[0]}`)
  // A ray leaving its own surface: the origin's pixel is never its hit.
  const own = marcher(W, H, (x) => (x === 20 ? 0.5 : 0.1)).hit([20.5, 30.5, 0.5], [100, 0, 0])
  assert.equal(own.at, undefined)
  // Hierarchical: far fewer reads than the 60 pixels crossed.
  assert.ok(loads < 40, `${loads} reads`)
})

test('a depth thinner than a pixel stops a ray at every slope, coarse levels never skip it', () => {
  for (const [wx, wy] of [
    [80, 31],
    [64, 32],
    [63, 33],
  ]) {
    const march = marcher(W, H, (x, y) => (x === wx && y === wy ? 0.9 : 0))
    // Aimed through the one-pixel wall's centre from far away.
    const o = [wx + 0.5 - 50, wy + 0.5 - 20, 0.5]
    const { at } = march.hit(o, [100, 40, 0])
    assert.ok(at, `hit ${wx},${wy}`)
    assert.deepEqual([Math.floor(at[0]), Math.floor(at[1])], [wx, wy])
  }
})

test('a ray passes a one-pixel gap in a wall and stops at the depth behind it', () => {
  // A wall at x = 70 with a gap on the ray's row, a second wall at x = 100.
  const march = marcher(W, H, (x, y) => {
    if (x === 70 && y !== 30) return 0.9
    return x === 100 ? 0.9 : 0.1
  })
  const { at } = march.hit([10.5, 30.5, 0.5], [110, 0, 0])
  assert.ok(at)
  assert.ok(at[0] >= 100 && at[0] < 101, `through the gap: ${at[0]}`)
  // One row below, the wall stops it.
  const below = march.hit([10.5, 31.5, 0.5], [110, 0, 0])
  assert.ok(below.at && below.at[0] >= 70 && below.at[0] < 71)
})

test('a ray moving away meets a depth where its own depth reaches it', () => {
  const march = marcher(W, H, () => 0.3)
  const o = [10.5, 20.5, 0.9],
    d = [100, 0, -0.9]
  const { at } = march.hit(o, d)
  assert.ok(at)
  // Where 0.9 - 0.9·t = 0.3: t = 2/3, x = 10.5 + 66.7.
  assert.ok(Math.abs(at[0] - (10.5 + (100 * 2) / 3)) < 1, `${at[0]}`)
  assert.ok(Math.abs(at[2] - 0.3) < 1e-6)
})

test('a ray across a full-HD image finds a far one-pixel depth within its step bound', () => {
  const march = marcher(1920, 1080, (x, y) => (x === 1800 && y === 900 ? 0.9 : 0.05))
  const o = [20.5, 10.5, 0.5]
  const { at, loads } = march.hit(o, [(1800.5 - 20.5) * 1.05, (900.5 - 10.5) * 1.05, 0])
  assert.ok(at, 'hit')
  assert.deepEqual([Math.floor(at[0]), Math.floor(at[1])], [1800, 900])
  assert.ok(loads <= REFLECTION_STEPS, `${loads} reads`)
})

test('a ray in front of everything leaves the screen: a miss, within its step bound', () => {
  const march = marcher(W, H, (x) => (x < 64 ? 0.2 : 0.1))
  const { at, loads } = march.hit([5.5, 5.5, 0.6], [200, 100, 0.2])
  assert.equal(at, undefined)
  assert.ok(loads <= REFLECTION_STEPS)
})

test('the view uniform carries the pixel scale, the held image and whether the screen traces', () => {
  // An infinite reversed perspective of 60° vertically, the eye at the origin.
  const f = 1 / Math.tan(Math.PI / 6),
    near = 0.1
  const viewProjection = [f / 2, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, -1, 0, 0, near, 0]
  const written: Float32Array[] = []
  const reflection = {
    words: new Float32Array(REFLECTION_VIEW_BYTES / 4),
    levels: 9,
    held: { valid: false, viewProjection: new Float64Array(16).fill(2), size: [200, 100] },
    device: {
      queue: { writeBuffer: (_: unknown, __: number, w: Float32Array) => written.push(w.slice()) },
    },
  } as unknown as ScreenReflection
  const frame = {
    viewProjection,
    inverseViewProjection: viewProjection,
    camera: [0, 0, 0, 1],
    size: [400, 300] as const,
    depthDrawn: true,
  }
  writeReflectionView(reflection, frame)
  const words = written[0],
    counts = new Uint32Array(words.buffer)
  // The world size of a pixel one unit away: 2·tan(30°) / 300.
  assert.ok(Math.abs(words[54] / ((2 * Math.tan(Math.PI / 6)) / 300) - 1) < 1e-6)
  assert.deepEqual([words[52], words[53], words[56], words[57], words[58]], [400, 300, 200, 100, 8])
  assert.equal(words[32], 2, "the held image's view-projection")
  assert.equal(counts[60], 0, 'no held image: the environment alone')
  reflection.held.valid = true
  writeReflectionView(reflection, frame)
  assert.equal(new Uint32Array(written[1].buffer)[60], 1)
  writeReflectionView(reflection, { ...frame, depthDrawn: false })
  assert.equal(new Uint32Array(written[2].buffer)[60], 0, 'a stale depth is never marched')
  // A still view writes the same words: nothing in them turns with the frame.
  writeReflectionView(reflection, frame)
  assert.deepEqual(written[3], written[1])
})

test('nothing a reflection reads turns with the frame: no seed, no frame rank, no history', () => {
  const text = wgslModule(reflectedRadianceWgsl(1))
  for (const name of ['jitter', 'frame', 'seed', 'noise', 'history', 'random', 'hash'])
    assert.doesNotMatch(text, new RegExp(`\\b${name}\\b`, 'i'), name)
})
