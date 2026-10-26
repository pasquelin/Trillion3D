// A ray marched through the global distance field, on the shipped text (`shaderRun`), over a synthetic field
// (`syntheticField.fixture.ts`): the plane and the box it meets within a voxel, the pages flagged as reached by two-sided
// meshes alone, the dithered transparency, the steps a clipmap, the hand-off to the next clipmap, the normal, the clip out
// of the outermost clipmap, and the sizes and the clipmaps the field takes while rays are marched through it. The
// coverage atlas and the object grid are `globalCoverage.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { GLOBAL_DISTANCE_FIELD_RULES } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import {
  clipmapExtent,
  numClipmaps,
  sizeForTraces,
} from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import { GDF_VIEW, GDF_VIEW_FLAG } from './globalReadWgsl.ts'
import { build, SIDE, type Input, type Vec3 } from './syntheticField.fixture.ts'
import { writeGdfView } from './view.ts'
import { DOWN, START, march, plane } from './globalTrace.fixture.ts'

test('a ray meets a plane at its place less the half voxel it expands the surface by, within a voxel', () => {
  const field = build({ extents: [140], sdf: plane })
  const hit = march(field, START, DOWN, 400)
  // A voxel is 10 cm, its half 5: the surface is expanded by the half voxel, a hit 100 cm along less 5.
  assert.ok(hit.hitTime >= 0)
  assert.ok(Math.abs(hit.hitTime - 100) < 10, `${hit.hitTime}`)
  assert.ok(Math.abs(hit.hitTime - 95) < 1, `the expansion: ${hit.hitTime}`)
  assert.equal(hit.clipmap, 0)
  assert.ok(Math.abs(hit.expand - 5) < 1e-4, `${hit.expand}`)
  assert.ok(hit.steps > 0 && hit.steps < 256)
  // A ray that falls away from it, or stops short of it, meets nothing.
  assert.equal(march(field, START, [0, 1, 0], 400).hitTime, -1)
  assert.equal(march(field, START, DOWN, 60).hitTime, -1)
})

test('a ray meets a box on its way within a voxel, from outside', () => {
  const box = (p: Vec3) => {
    const q = [Math.abs(p[0]) - 30, Math.abs(p[1] - 40) - 20, Math.abs(p[2]) - 30]
    return Math.hypot(...q.map((c) => Math.max(c, 0))) + Math.min(Math.max(...q), 0)
  }
  const field = build({ extents: [140], sdf: box })
  // The box's top face is at y = 60; a ray falls on it from 130 along y.
  const hit = march(field, [5, 130, 3], DOWN, 400)
  assert.ok(Math.abs(hit.hitTime - 70) < 10, `${hit.hitTime}`)
  // Along the side it passes by, 40 cm out of the box, the ray meets nothing.
  assert.equal(march(field, [75, 130, 0], DOWN, 400).hitTime, -1)
})

test('a page flagged as reached by two-sided meshes alone expands the surface less, and steps further', () => {
  const covered = march(build({ extents: [140], sdf: plane }), START, DOWN, 400)
  const flagged = build({ extents: [140], sdf: plane, flagged: () => true })
  const loose = march(flagged, START, DOWN, 400)
  // The half voxel by 1 for a covered page, by 0.6 for a flagged one.
  assert.ok(Math.abs(covered.expand - 5) < 1e-4)
  assert.ok(Math.abs(loose.expand - 3) < 1e-4, `${loose.expand}`)
  assert.ok(Math.abs(loose.hitTime - 97) < 1, `${loose.hitTime}`)
  // The least step is four times longer there: the march takes no more steps than over covered pages.
  assert.ok(loose.steps <= covered.steps, `${loose.steps} against ${covered.steps}`)
  // A ray expanded by the time (the default) is not, near its start: the expansion grows from 0 over two half voxels.
  const early = march(build({ extents: [140], sdf: plane }), [0, 22, 0], DOWN, 400)
  assert.ok(early.hitTime >= 0 && early.hitTime < 5, `${early.hitTime}`)
  assert.ok(early.expand < 5, `the expansion has not grown yet: ${early.expand}`)
})

test('a ray that expands by the largest distance it read does not wait for its time to expand', () => {
  const field = build({ extents: [140], sdf: plane })
  const byDistance = march(field, [0, 40, 0], DOWN, 400, (i) => (i.expandByTime = false))
  // 120 cm above the plane at the start it has read a distance of 40: the expansion is full at once.
  assert.ok(Math.abs(byDistance.expand - 5) < 1e-4, `${byDistance.expand}`)
})

test('a dithered ray is stopped by a flagged page only where the noise lets it, by a covered one always', () => {
  const dithered = (i: Input) => {
    i.dithered = true
    i.ditherCoord = [3, 5]
  }
  const hit = (flagged: boolean, dither: [number, number]) =>
    march(
      build({ extents: [140], sdf: plane, flagged: () => flagged, dither }),
      START,
      DOWN,
      400,
      dithered,
    ).hitTime
  assert.ok(hit(false, [0, 0]) >= 0, 'a covered page stops it whatever the thresholds')
  assert.equal(hit(true, [0, 0]), -1, 'no noise is under a threshold of 0: the ray goes through')
  assert.ok(hit(true, [1, 1]) >= 0, 'every noise is under a threshold of 1')
  // The thresholds weigh the noise of the step and of the trace: one of them at 0 lets the ray through.
  assert.equal(hit(true, [1, 0]), -1)
  assert.equal(hit(true, [0, 1]), -1)
})

test('the steps a clipmap are bounded, and counted', () => {
  // A ray that skims the plane 20 cm above it, across the clipmap: a dozen steps of the distance, three where it is bounded.
  const skim = (steps: number) =>
    march(build({ extents: [140], sdf: plane, steps }), [-130, 40, 0], [1, 0, 0], 400)
  const free = skim(256)
  assert.equal(free.hitTime, -1)
  assert.ok(free.steps > 5 && free.steps < 30, `${free.steps}`)
  const spent = skim(3)
  assert.deepEqual([spent.hitTime, spent.steps], [-1, 3])
})

test('a ray goes on in the next clipmap where it leaves the first, and meets a surface only the next one holds', () => {
  // The plane at y = 200 lies outside the first clipmap (±140) and inside the second (±280).
  const high = (p: Vec3) => 200 - p[1]
  const field = build({ extents: [140, 280], sdf: high })
  const hit = march(field, [0, 0, 0], [0, 1, 0], 400)
  assert.equal(hit.clipmap, 1)
  // The second clipmap's half voxel is 10 cm: the surface is expanded by it.
  assert.ok(Math.abs(hit.hitTime - 190) < 2, `${hit.hitTime}`)
  assert.equal(field.gdfClipmapAt([0, 0, 0]), 0)
  assert.equal(
    field.gdfClipmapAt([0, 138, 0]),
    1,
    'within a half voxel of the first clipmap’s edge: the next',
  )
  assert.equal(field.gdfClipmapAt([0, 1000, 0]), 0, 'outside all of them: the first')
})

test('the normal is the direction the distance grows in, the fallback where the field is flat', () => {
  const sphere = (p: Vec3) => Math.hypot(...p) - 60
  const field = build({ extents: [140], sdf: sphere })
  const unit = Math.SQRT1_2
  const at: Vec3 = [60 * unit, 60 * unit, 0]
  const normal = field.gdfNormal(at, 0, [0, 0, 1])
  assert.ok(normal[0] * unit + normal[1] * unit > 0.98, `${normal}`)
  assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-4)
  // Far from every surface the pages hold a flat 1: no gradient.
  assert.deepEqual(field.gdfNormal([120, 120, 0], 0, [0, 1, 0]), [0, 1, 0])
})

test('the ray is drawn out of the last clipmap where it leaves it, pulled back by its steps’ jitter', () => {
  const field = build({ extents: [140, 280], sdf: plane })
  const out = field.gdfClipRayOutside([0, 0, 0], [1, 0, 0], 1000, 16)
  const leaves = (280 * (1 - 1 / SIDE)) / 1000
  assert.ok(Math.abs(out.start - (leaves + (leaves - 1) / 31) * 1000) < 1e-3, `${out.start}`)
  assert.ok(Math.abs(out.start + out.length - 1000) < 1e-3)
  assert.deepEqual(
    [field.gdfClipRayOutside([0, 900, 0], [1, 0, 0], 1000, 16).start],
    [0],
    'a ray that never meets the box is unchanged',
  )
})

test('while rays are marched the field takes the sizes of a march and its block carries the options of a ray', () => {
  const settings = resolveSettings(GLOBAL_DISTANCE_FIELD_RULES, {})
  assert.equal(settings.globalDistanceFieldResolution, 128)
  assert.equal(clipmapExtent(settings, 0), 2500)
  sizeForTraces(settings)
  // 252 voxels across a clipmap whose half-extent is 2 500 cm, each next one twice the one before.
  assert.equal(settings.globalDistanceFieldResolution, 252)
  assert.deepEqual(
    [0, 1, 2, 3].map((k) => clipmapExtent(settings, k)),
    [2500, 5000, 10000, 20000],
  )
  const words = new Float32Array(GDF_VIEW.words)
  const plan = { index: 0, extent: 2500, center: [0, 0, 0], scroll: [0, 0, 0], updates: [] }
  writeGdfView(words, 0, settings, [plan as never], [0, 0, 0], 0, {
    textured: false,
    coverageBase: 77,
  })
  const at = GDF_VIEW.at
  assert.equal(new Uint32Array(words.buffer)[at.traceSteps], 256)
  assert.equal(new Uint32Array(words.buffer)[at.flags], 0)
  assert.equal(
    new Uint32Array(words.buffer)[at.coverageBase],
    77,
    'the word the coverage atlas begins at',
  )
  // The flags: the page atlas a texture, the simple coverage.
  settings.globalDistanceFieldSimpleCoverageBasedExpand = true
  writeGdfView(words, 0, settings, [plan as never], [0, 0, 0], 0, {
    textured: true,
    coverageBase: 0,
  })
  assert.equal(
    new Uint32Array(words.buffer)[at.flags],
    GDF_VIEW_FLAG.atlasTexture | GDF_VIEW_FLAG.simpleCoverage,
  )
  settings.globalDistanceFieldSimpleCoverageBasedExpand = false
  assert.deepEqual(
    [
      at.expandCovered,
      at.expandNotCovered,
      at.minStepNotCovered,
      at.ditherStep,
      at.ditherTrace,
    ].map((word) => Math.fround(words[word])),
    [1, 0.6, 4, 0.5, 0.9].map(Math.fround),
  )
})

test('the clipmaps grow with the view distance while rays are marched: one at the extent of the next, two at the one after', () => {
  const count = (options: Record<string, number | boolean>) => {
    const settings = resolveSettings(GLOBAL_DISTANCE_FIELD_RULES, options)
    sizeForTraces(settings)
    return numClipmaps(settings)
  }
  const view = (distance: number, more = {}) => ({
    globalDistanceFieldTraceViewDistance: distance,
    ...more,
  })
  // The first clipmap reaches 2 500 and each next twice the one before: the fifth 40 000, the sixth 80 000.
  assert.equal(count({}), 4, 'the view distance of 20 000 asks for none')
  assert.equal(count(view(39999)), 4)
  assert.equal(count(view(40000)), 5)
  assert.equal(count(view(79999)), 5)
  assert.equal(count(view(80000)), 6)
  assert.equal(count(view(10_000_000)), 6, 'held to 6')
  // Three asked: the fourth reaches 20 000, the fifth 40 000.
  assert.equal(count({ globalDistanceFieldClipmaps: 3 }), 4)
  assert.equal(count(view(40000, { globalDistanceFieldClipmaps: 3 })), 5)
  assert.equal(count(view(79999, { globalDistanceFieldClipmaps: 5 })), 5)
  assert.equal(count(view(80000, { globalDistanceFieldClipmaps: 5 })), 6)
  // The fast camera mode adds its own, after.
  assert.equal(count({ globalDistanceFieldFastCameraMode: true }), 5)
  // A field no ray is marched through keeps the clipmaps the options ask.
  assert.equal(numClipmaps(resolveSettings(GLOBAL_DISTANCE_FIELD_RULES, view(80000))), 4)
})
