// The reflection's shipped WGSL run as JavaScript (`shaderRun`, `scene.fixture.ts`): the cone's
// half-angle and the elliptical footprint it reads, the fades that blend the screen into the
// environment, the lobe's zonal moments, and the march through the field of slabs — a hit where a
// depth stands, none through a gap, none through a depth thinner than a pixel, past a depth deeper
// than its slab, never on the pixel centres a ray skims in front of —, then whole views of a thin
// sheet over a plank at grazing angles, where no hit lies where the exact ray cast meets nothing or
// meets something farther.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import {
  REFLECTION_CONE_WGSL,
  REFLECTION_EDGE,
  REFLECTION_ENVIRONMENT_WGSL,
  REFLECTION_FADE_ROUGHNESS,
  REFLECTION_STEPS,
  REFLECTION_TAPS,
  REFLECTION_THICKNESS,
  REFLECTION_TRACE_ROUGHNESS,
  REFLECTION_VIEW_WRITTEN_BYTES,
  reflectedRadianceWgsl,
} from './wgsl.ts'
import { SURROUNDINGS_SHADER, writeReflectionView, type ScreenReflection } from './gpu.ts'
import { TONE_MAPPING_WGSL } from '../lighting/toneMappingWgsl.ts'
import { TONE_MAPPING_RANK } from '../../../sdk-core/src/scene/core/environment.ts'
import { linearToSrgb, srgbToLinear } from '../../../math/src/color/color.ts'
import {
  camera,
  castBoxes,
  depthField,
  reflectionRunner,
  sceneOver,
  viewOf,
  type Box,
  type V3,
} from './scene.fixture.ts'

type Cone = {
  reflectionConeTangent: (alpha: number) => number
  reflectionEdgeFade: (pixel: number[], size: number[]) => number
  reflectionThicknessFade: (gap: number, thickness: number) => number
  reflectionTraceWeight: (rough: number) => number
}
const cone = shaderRun<Cone>(
  wgslModule(REFLECTION_CONE_WGSL),
  [
    'reflectionConeTangent',
    'reflectionEdgeFade',
    'reflectionThicknessFade',
    'reflectionTraceWeight',
  ],
  {},
)

test('the cone is closed on a mirror and opens with the lobe, as GGX at half its peak', () => {
  assert.equal(cone.reflectionConeTangent(0), 0)
  // Wider at every α, until the half-vector's angle reaches its 40° bound.
  let last = 0
  for (let alpha = 0.05; alpha <= 1; alpha += 0.05) {
    const tangent = cone.reflectionConeTangent(alpha)
    assert.ok(alpha > 0.6 ? tangent >= last : tangent > last, `wider at ${alpha}`)
    last = tangent
  }
  // Small α: the half-vector's half-maximum angle is α√(√2 − 1), the reflected cone's twice it.
  const alpha = 0.01
  assert.ok(
    Math.abs(cone.reflectionConeTangent(alpha) / (2 * alpha * Math.sqrt(Math.SQRT2 - 1)) - 1) <
      1e-3,
  )
  assert.ok(Number.isFinite(cone.reflectionConeTangent(1)))
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
  assert.equal(cone.reflectionEdgeFade([3, 100], size), cone.reflectionEdgeFade([317, 100], size))
})

test('a hit behind its plane fades out over the slab, smoothly', () => {
  const thickness = 2
  assert.equal(cone.reflectionThicknessFade(0, thickness), 1)
  assert.equal(cone.reflectionThicknessFade(0.5 * thickness, thickness), 1)
  assert.equal(cone.reflectionThicknessFade(thickness, thickness), 0)
  assert.equal(cone.reflectionThicknessFade(10 * thickness, thickness), 0)
  assert.ok(Math.abs(cone.reflectionThicknessFade(0.75 * thickness, thickness) - 0.5) < 1e-9)
})

test('the screen gives way to the environment over the trace roughness range', () => {
  assert.equal(cone.reflectionTraceWeight(0), 1)
  assert.equal(cone.reflectionTraceWeight(REFLECTION_FADE_ROUGHNESS), 1)
  assert.equal(cone.reflectionTraceWeight(REFLECTION_TRACE_ROUGHNESS), 0)
  assert.equal(cone.reflectionTraceWeight(1), 0)
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

test('the surroundings add to the environment whole, at every roughness', () => {
  const directLights = { environment: Array.from({ length: 9 }, () => [0, 0, 0, 0]) }
  directLights.environment[0] = [0.4, 0.2, 0.1, 0]
  const view = { surroundings: [0.25, 0.5, 0.125, 0] }
  const run = (surroundings: number[]) =>
    shaderRun<{ reflectionEnvironment: (R: number[], rough: number) => number[] }>(
      wgslModule(REFLECTION_ENVIRONMENT_WGSL),
      ['reflectionEnvironment', 'reflectionBands'],
      { directLights, reflectionView: { surroundings } },
    )
  for (const rough of [0.05, 0.5, 1])
    for (const R of [
      [0, 1, 0],
      [0.6, 0, 0.8],
    ]) {
      const bare = run([0, 0, 0, 0]).reflectionEnvironment(R, rough)
      const lit = run(view.surroundings).reflectionEnvironment(R, rough)
      for (let c = 0; c < 3; c++)
        assert.ok(Math.abs(lit[c] - bare[c] - view.surroundings[c]) < 1e-12)
    }
})

/** An orthographic view of `width × height` pixels whose world is its NDC: depth along +z, toward
 *  the eye, a slab of `2 · REFLECTION_THICKNESS` in depth. */
function flatView(width: number, height: number) {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  return viewOf(identity, identity, [0, 0, 1, 0], [width, height], 2 / height)
}
const SLAB = 2 * REFLECTION_THICKNESS

/** The shipped march over the depth image `depth`, `width × height`. */
function marcher(width: number, height: number, depth: (x: number, y: number) => number) {
  const image = Float64Array.from({ length: width * height }, (_, i) =>
    depth(i % width, Math.floor(i / width)),
  )
  const run = reflectionRunner(depthField(width, height, image), flatView(width, height))
  const size = [width, height]
  return {
    /** Where the ray from `o` along `d` stops on the screen, or undefined: a miss. */
    hit(o: number[], d: number[]) {
      run.counter.loads = 0
      const { t } = run.reflectionMarch(
        o,
        d,
        run.reflectionScreenEnd(o.slice(0, 2), d.slice(0, 2), size),
      )
      return { at: t < 0 ? undefined : o.map((x, k) => x + d[k] * t), loads: run.counter.loads }
    },
  }
}

// Reversed depth: 1 at the near plane, 0 at infinity. The background reads 0.
const W = 128,
  H = 64
/** A depth the ray at 0.5 lies within the slab of. */
const NEAR_WALL = 0.5 + SLAB / 2

test('a ray stops at the first depth it lies within the slab of, its own pixel never', () => {
  // A wall one pixel wide at x = 80 over a far floor; the ray at a constant depth of 0.5.
  const march = marcher(W, H, (x) => (x === 80 ? NEAR_WALL : 0.1))
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
    const march = marcher(W, H, (x, y) => (x === wx && y === wy ? NEAR_WALL : 0))
    const o = [wx + 0.5 - 50, wy + 0.5 - 20, 0.5]
    const { at } = march.hit(o, [100, 40, 0])
    assert.ok(at, `hit ${wx},${wy}`)
    assert.deepEqual([Math.floor(at[0]), Math.floor(at[1])], [wx, wy])
  }
})

test('a ray passes a one-pixel gap in a wall and stops at the depth behind it', () => {
  const march = marcher(W, H, (x, y) => {
    if (x === 70 && y !== 30) return NEAR_WALL
    return x === 100 ? NEAR_WALL : 0.1
  })
  const { at } = march.hit([10.5, 30.5, 0.5], [110, 0, 0])
  assert.ok(at)
  assert.ok(at[0] >= 100 && at[0] < 101, `through the gap: ${at[0]}`)
  const below = march.hit([10.5, 31.5, 0.5], [110, 0, 0])
  assert.ok(below.at && below.at[0] >= 70 && below.at[0] < 71)
})

test('a ray passes behind a depth deeper than its slab, and stops at the one behind it', () => {
  // The first wall stands 0.3 in front of the ray, five slabs: the ray goes behind it.
  const march = marcher(W, H, (x) => (x === 60 ? 0.8 : x === 90 ? NEAR_WALL : 0.1))
  const { at } = march.hit([20.5, 30.5, 0.5], [100, 0, 0])
  assert.ok(at && at[0] >= 90 && at[0] < 91, `behind the first wall: ${at?.[0]}`)
})

test('a ray moving away meets a depth where its own depth reaches it', () => {
  const march = marcher(W, H, () => 0.3)
  const { at } = march.hit([10.5, 20.5, 0.9], [100, 0, -0.9])
  assert.ok(at)
  // Where 0.9 - 0.9·t = 0.3: t = 2/3, x = 10.5 + 66.7.
  assert.ok(Math.abs(at[0] - (10.5 + (100 * 2) / 3)) < 1, `${at[0]}`)
  assert.ok(Math.abs(at[2] - 0.3) < 1e-6)
})

test('a ray skimming a surface seen edge-on never stops on the centres it passes behind', () => {
  // A plane whose depth climbs 0.004 a row, its pixels holding their centres' depth; a ray along
  // a row near its top edge, a hair in front of the plane there but behind every centre.
  const slope = 0.004
  const plane = (y: number) => 0.2 + slope * y
  const march = marcher(W, H, (_, y) => plane(y + 0.5))
  const y = 40.1,
    z = plane(y) + 1e-4
  assert.ok(z < plane(40.5), 'behind the row centres')
  const { at } = march.hit([5.5, y, z], [200, 0, 0])
  assert.equal(at, undefined, `no hit: ${at}`)
  // The same ray a hair behind the plane meets it at once.
  const behind = march.hit([5.5, y, plane(y) - 1e-4], [200, 0, 0])
  assert.ok(behind.at && behind.at[0] < 8, `${behind.at}`)
})

test('a ray across a wide image finds a far one-pixel depth within its step bound', () => {
  const march = marcher(640, 360, (x, y) => (x === 600 && y === 330 ? NEAR_WALL : 0.05))
  const o = [20.5, 10.5, 0.5]
  const { at, loads } = march.hit(o, [(600.5 - 20.5) * 1.05, (330.5 - 10.5) * 1.05, 0])
  assert.ok(at, 'hit')
  assert.deepEqual([Math.floor(at[0]), Math.floor(at[1])], [600, 330])
  assert.ok(loads <= REFLECTION_STEPS, `${loads} reads`)
})

test('a ray in front of everything leaves the screen: a miss, within its step bound', () => {
  const march = marcher(W, H, (x) => (x < 64 ? 0.2 : 0.1))
  const { at, loads } = march.hit([5.5, 5.5, 0.6], [200, 100, 0.2])
  assert.equal(at, undefined)
  assert.ok(loads <= REFLECTION_STEPS)
})

/**
 * A sheet standing over a plank on a slab, the sheet a blended surface outside the depth — a pane
 * or a disc —, seen from around it at grazing angles: every hit its front face's mirror rays make
 * lies where the exact cast of the same boxes puts it, or past it, never where the cast meets
 * nothing or before it — save on a pixel that does not hold one plane alone (a silhouette or a
 * crease, within a pixel of it), whose surface the image does not tell.
 */
test('a thin sheet over a plank reflects no streak at grazing angles', () => {
  const ground: Box = { low: [-8, -0.2, -5], high: [8, 0, 5] },
    plank: Box = { low: [-3, 0, -0.4], high: [3, 0.12, 0.4] },
    sheet: Box = { low: [-1.2, 0.3, -0.02], high: [1.2, 2.2, 0.02] }
  const boxes = [ground, plank]
  const Wv = 192,
    Hv = 108
  let hits = 0
  for (const [azimuth, height] of [
    [0, 4.5],
    [25, 1.2],
    [50, 2.5],
    [60, 4],
    [70, 1.5],
    [-40, 0.8],
  ]) {
    const a = (azimuth * Math.PI) / 180
    const eye: V3 = [9 * Math.sin(a), height, 9 * Math.cos(a)]
    const view = camera(eye, [0, 0.8, 0], Wv, Hv, (50 * Math.PI) / 180)
    const scene = sceneOver(view, boxes)
    const onePlane = (x: number, y: number) => {
      const plane = scene.shown[y * Wv + x]
      for (let v = Math.max(0, y - 1); v <= Math.min(Hv - 1, y + 1); v++)
        for (let u = Math.max(0, x - 1); u <= Math.min(Wv - 1, x + 1); u++)
          if (scene.shown[v * Wv + u] !== plane) return false
      return true
    }
    for (let y = 0; y < Hv; y++)
      for (let x = 0; x < Wv; x++) {
        const d = view.ray(x + 0.5, y + 0.5)
        const front = castBoxes(eye, d, [sheet])
        if (!(front.t < castBoxes(eye, d, boxes).t)) continue
        const P = [0, 1, 2].map((k) => eye[k] + d[k] * front.t) as V3
        if (Math.abs(P[2] - sheet.high[2]) > 1e-9) continue
        const R: V3 = [d[0], d[1], -d[2]]
        const seen = scene.reflectionSeen(P, [0, 0, 1], R, 0.01, [0, 0, 0, 0.01])
        if (!(seen.fade > 0)) continue
        hits++
        const Q = seen.color
        if (!onePlane(Math.floor(Q[0]), Math.floor(Q[1]))) continue
        const exact = castBoxes(P, R, boxes, 1e-6).t
        assert.ok(
          Number.isFinite(exact),
          `${azimuth}° ${height}: a hit where nothing is, ${x},${y}`,
        )
        const S = view.project(P),
          T = view.project([0, 1, 2].map((k) => P[k] + R[k] * exact) as V3)
        const reached = Math.hypot(Q[0] - S[0], Q[1] - S[1]),
          truth = Math.hypot(T[0] - S[0], T[1] - S[1])
        assert.ok(reached > truth - 2, `${azimuth}° ${height}: a hit before the surface, ${x},${y}`)
      }
  }
  assert.ok(hits > 500, `${hits} hits`)
})

test('a round footprint is one tap at its level; a stretched one, taps along its long axis', () => {
  const view = camera([0, 1, 6], [0, 1, 0], 320, 180)
  // Each tap the footprint takes, as the point and level it reads.
  const read: number[][] = []
  const run = reflectionRunner(
    depthField(1, 1, [0]),
    viewOf(view.m, view.inverse, [...view.eye, 1], [320, 180], view.scale),
    {
      reflectionRadianceAt: (uv: number[], level: number) => {
        const tap = [uv[0] * 320, uv[1] * 180, level, 1]
        read.push(tap)
        return tap
      },
    },
  )
  const { reflectionConeTangent } = shaderRun<{ reflectionConeTangent: (a: number) => number }>(
    wgslModule(REFLECTION_CONE_WGSL),
    ['reflectionConeTangent'],
    {},
  )
  const hit: V3 = [0, 1, 0],
    R: V3 = [0, 0, 1],
    Q = view.project(hit).slice(0, 2),
    pixel = view.project(hit)[3] * view.scale
  /** The footprint's taps from `P`, two metres or more from the hit, of `alpha` and `lobe`. */
  const taps = (P: V3, alpha: number, lobe: number[]) => {
    read.length = 0
    const mean = run.reflectionFootprint(Q, hit, P, R, pixel, alpha, lobe)
    return { mean, taps: [...read] }
  }
  const axis = (distance: number, alpha: number) =>
    (2 * distance * reflectionConeTangent(alpha)) / pixel
  // Round — its direction any —: one tap at Q, the level of the cone's diameter in pixels.
  const alpha = 0.04
  for (const lobe of [
    [0, 0, 0, alpha],
    [1, 0, 0, alpha],
  ]) {
    const round = taps([0, 1, 2], alpha, lobe)
    assert.equal(round.taps.length, 1)
    assert.deepEqual(round.taps[0].slice(0, 2), Q)
    assert.ok(Math.abs(round.mean[2] - Math.log2(axis(2, alpha))) < 1e-9)
  }
  // Twice as far, one level up: contact hardening.
  const far = taps([0, 1, 4], alpha, [0, 0, 0, alpha])
  assert.ok(Math.abs(far.mean[2] - Math.log2(axis(2, alpha)) - 1) < 1e-9)
  // Stretched along x: taps on the image's x axis, symmetric about Q, as many as the axes' ratio
  // asks up to the bound, at the short axis's level — or the long axis's share of a tap past it —,
  // their weights one each over their count.
  for (const stretch of [0.06, 0.08, 0.5]) {
    const { mean, taps: reads } = taps([0, 1, 2], alpha, [1, 0, 0, stretch])
    const short = axis(2, alpha),
      long = axis(2, stretch)
    assert.equal(reads.length, Math.min(Math.ceil(long / short), REFLECTION_TAPS), `${stretch}`)
    assert.ok(
      reads.every((tap) => Math.abs(tap[1] - Q[1]) < 1e-9),
      'along x',
    )
    assert.ok(Math.abs(mean[0] - Q[0]) < 1e-9 && Math.abs(mean[1] - Q[1]) < 1e-9, `${mean}`)
    const width = Math.max(short, long / REFLECTION_TAPS)
    assert.ok(Math.abs(mean[2] - Math.log2(width)) < 1e-9, `${stretch}: ${mean[2]}`)
    // The taps span the long axis less one tap's width, evenly.
    const xs = reads.map((tap) => tap[0]).sort((p, q) => p - q)
    const span = xs.at(-1)! - xs[0]
    assert.ok(
      Math.abs(span - ((long - width) * (reads.length - 1)) / reads.length) < 1e-6,
      `${span}`,
    )
  }
})

test('the view uniform carries the pixel scale, the held image, the display and whether the screen traces', () => {
  // An infinite reversed perspective of 60° vertically, the eye at the origin.
  const f = 1 / Math.tan(Math.PI / 6),
    near = 0.1
  const viewProjection = [f / 2, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, -1, 0, 0, near, 0]
  const written: Float32Array[] = []
  const reflection = {
    words: new Float32Array(REFLECTION_VIEW_WRITTEN_BYTES / 4),
    levels: 8,
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
    display: { background: [0.25, 0.5, 0.75] as const, exposure: 2, curve: 4 },
  }
  writeReflectionView(reflection, frame)
  const words = written[0],
    counts = new Uint32Array(words.buffer)
  // The world size of a pixel one unit away: 2·tan(30°) / 300.
  assert.ok(Math.abs(words[54] / ((2 * Math.tan(Math.PI / 6)) / 300) - 1) < 1e-6)
  assert.deepEqual([words[52], words[53], words[56], words[57], words[58]], [400, 300, 200, 100, 7])
  assert.equal(words[32], 2, "the held image's view-projection")
  assert.equal(counts[60], 0, 'no held image: the environment alone')
  assert.equal(counts[61], 4, "the display curve's rank")
  assert.deepEqual([...words.slice(64, 68)], [0.25, 0.5, 0.75, 2])
  assert.equal(words.length * 4, REFLECTION_VIEW_WRITTEN_BYTES, 'the surroundings are not written')
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

test('a scene with no light around it is surrounded by its background, as the display shows it', () => {
  const view = {
    counts: [0, TONE_MAPPING_RANK.aces, 0, 0],
    // The background 0x171d28 displayed, in linear, and an exposure of 2.
    display: [...[0x17, 0x1d, 0x28].map((b) => srgbToLinear(b / 255)), 2],
    surroundings: [9, 9, 9, 9],
  }
  const environment = Array.from({ length: 9 }, () => [0, 0, 0, 0])
  const run = shaderRun<{ reflectionSurroundings: () => void; aces: (c: number[]) => number[] }>(
    SURROUNDINGS_SHADER + wgslModule(TONE_MAPPING_WGSL),
    [
      'reflectionSurroundings',
      'toneUnmap',
      'acesInverse',
      'cineonInverse',
      'agxInverse',
      'neutralInverse',
      'aces',
    ],
    { directLights: { environment }, view },
  )
  run.reflectionSurroundings()
  // A mirror (its weight one) shows it through the exposure and the curve: the background's bytes.
  const shown = run.aces(view.surroundings.slice(0, 3).map((c) => c * 2))
  assert.deepEqual(
    shown.map((c) => Math.round(linearToSrgb(c) * 255)),
    [0x17, 0x1d, 0x28],
  )
  // A scene that declares light around it — one coefficient — answers alone.
  environment[3] = [0, 0.1, 0, 0]
  run.reflectionSurroundings()
  assert.deepEqual(view.surroundings, [0, 0, 0, 0])
})
