// The screen-space ambient occlusion beside the disc search's own tests (`../standardLighting.test.ts`, `../deferred/`): the
// horizon method's frame — its passes, its history, the filters, the budget's refusal, the metrics — and its passes run as shipped
// (`shaderRun`) against the same passes written apart (`horizon/chain.fixture.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { installGpuDeviceLedger } from '../../gpu/core/deviceLedger.ts'
import { ambientOcclusionMetrics, encodeAmbientOcclusion } from './frame.ts'
import { runHorizon } from './horizon/chain.fixture.ts'
import { encodeMotion } from './horizon/filters.fixture.ts'
import { HORIZON_PARAMS, HORIZON_PARAMS_BYTES } from './horizon/layout.ts'
import { occlusionRuntime } from './occlusion.fixture.ts'
import { AO_SETUP_WGSL } from './setupWgsl.ts'
import { createScene, HEIGHT, sceneScope, settingsOf, uniformOf, WIDTH } from './scene.fixture.ts'

const GEOMETRY = { floor: 1.5, wall: 6, box: 3.5 }
const history = (x: number, y: number) => 0.5 + 0.3 * Math.sin(x * 0.7 + y * 0.3)
const worstOf = (a: number[][], b: number[][]) =>
  Math.max(...a.flatMap((row, y) => row.map((v, x) => Math.abs(v - b[y][x]))))

test('the horizon method draws its search, its spatial filter as a compute pass, its temporal filter and its upsample', async () => {
  const run = await occlusionRuntime({ ambientOcclusionMethod: 'horizon' })
  await run.encode()
  // The search, the temporal filter and the upsample are fullscreen draws into one byte a pixel; the spatial filter, between the
  // first two, is one dispatch over 16 × 8 groups of the rectangle, into a float texture it writes as storage.
  assert.deepEqual(run.labels(), ['2d', 'temporal', 'upsample'])
  assert.deepEqual(
    run.h.passes.slice(-3).map((pass) => pass.formats[0]),
    Array(3).fill('r8unorm'),
  )
  const spatial = run.h.dispatches.filter((dispatch) => dispatch.entryPoint === 'hzSpatialMain')
  assert.deepEqual(
    spatial.map(({ direct, rows }) => [direct, rows]),
    [[4, 8]],
  )
  // Four textures of a byte a pixel — the search's, the history's pair and the occlusion — the spatial filter's float, a uniform a pass.
  assert.equal(run.rt.gpu.ambientOcclusion!.bytes, (4 + 4) * 64 * 64 + 4 * HORIZON_PARAMS_BYTES)
  // With both filters off the search is followed by the upsample alone, and no compute pass runs.
  const plain = await occlusionRuntime({
    ambientOcclusionMethod: 'horizon',
    ambientOcclusionHorizonTemporal: false,
    ambientOcclusionHorizonSpatial: false,
  })
  await plain.encode()
  assert.deepEqual(plain.labels(), ['2d', 'upsample'])
  assert.equal(plain.h.dispatches.filter((d) => d.entryPoint === 'hzSpatialMain').length, 0)
})

test('the horizon history is the view’s: it turns between two textures, survives a change of settings, and goes with a cut or a remade view', async () => {
  const run = await occlusionRuntime({ ambientOcclusionMethod: 'horizon' })
  await run.encode()
  // The uniform of the temporal pass (the third) as the device holds it: every write replayed, a word that did not move never sent again.
  const rectangle = () => {
    const image = new Float32Array(HORIZON_PARAMS.words)
    for (const write of run.h.writes)
      if (String((write.buffer as { label?: string })?.label).includes('pass 2'))
        image.set(
          new Float32Array(new Uint32Array(write.data as ArrayLike<number>).buffer),
          write.offset / 4,
        )
    return [...image.slice(HORIZON_PARAMS.at.history, HORIZON_PARAMS.at.history + 2)]
  }
  const target = () => run.h.passes.at(-2)!.colors[0]!.view
  const first = target()
  assert.deepEqual(rectangle(), [1, 1], 'the first image has none: a texel of white')
  await run.encode()
  assert.deepEqual(rectangle(), [64, 64], 'the next image reads the one before')
  assert.notEqual(
    target(),
    first,
    'the two histories take turns: it writes the one it did not read',
  )
  // A setting that moves no texture keeps the history: the intensity is dragged, the history goes on accumulating.
  Object.assign(run.rt.context, { ambientOcclusionIntensity: 0.7 })
  await run.encode()
  assert.deepEqual(rectangle(), [64, 64], 'a change of the intensity keeps it')
  assert.equal(target(), first, 'and the turn goes on')
  Object.assign(run.rt.run.gate, { temporalRevision: run.rt.run.gate.temporalRevision + 1 })
  await run.encode()
  assert.deepEqual(rectangle(), [1, 1], 'a cut drops it')
  await run.encode()
  assert.deepEqual(rectangle(), [64, 64])
  // A setting that makes the textures again — the search at half size — leaves no history in the new ones.
  Object.assign(run.rt.context, { ambientOcclusionHorizonDownsample: true })
  await run.encode()
  assert.deepEqual(rectangle(), [1, 1], 'a view made again starts without one')
})

test('a budget that leaves no room refuses the view once, says why in the metrics, and is asked again when room holds the view', async () => {
  const run = await occlusionRuntime({ ambientOcclusionMethod: 'horizon' })
  let limit = 100
  installGpuDeviceLedger(run.h.device, { limit: () => limit })
  const state = () => run.rt.gpu.ambientOcclusion
  for (let waited = 0; waited < 100 && !state()?.refusal; waited++) {
    encodeAmbientOcclusion(run.rt, run.h.encoder, run.camera)
    await new Promise((done) => setImmediate(done))
  }
  const metrics = ambientOcclusionMetrics(state())
  assert.equal(metrics?.drawn, false)
  assert.match(metrics?.why ?? '', /no room for the ambient occlusion/)
  const refused = state()!.refusal
  encodeAmbientOcclusion(run.rt, run.h.encoder, run.camera)
  assert.equal(state()!.refusal, refused, 'asked again only when the room holds the view')
  limit = 1e12
  await run.encode()
  assert.deepEqual(
    [ambientOcclusionMetrics(state())?.drawn, ambientOcclusionMetrics(state())?.why],
    [true, null],
  )
  assert.equal(ambientOcclusionMetrics(undefined), undefined)
})

test('a missing history is white: the first image of an open wall is the image drawn over a history of nothing but white', () => {
  const first = runHorizon({ wall: 5 }, {}, {})
  const white = runHorizon({ wall: 5 }, {}, { history: () => 1 })
  assert.ok(first.worst < 2e-6 && white.worst < 2e-6)
  assert.ok(worstOf(first.wgsl.ao, white.wgsl.ao) < 1e-6, 'the same image, at the corner too')
  assert.ok(
    Math.min(...first.wgsl.ao.flat()) > 0.99,
    'an open wall stays open at the picture’s edge',
  )
})

test('what a camera that moved left outside the picture reads white, held to the range about this image’s value', () => {
  // A history of black and a camera that shifted a little: the last column's point was partly outside the last image, where the
  // history reads white (clamped to the range's upper end); the column beside it was inside, where it reads black (its lower end).
  const moved = runHorizon({ wall: 5 }, {}, { history: () => 0, shift: 0.005 })
  assert.ok(moved.worst < 2e-6)
  const row = moved.wgsl.ao[18]
  assert.ok(row[63] > row[62] + 0.01, `outside ${row[63]} against inside ${row[62]}`)
})

test('with the spatial filter off the last pass applies the power and the intensity, so the unoccluded wall is whole, not 36 % dark', () => {
  const off = { ambientOcclusionHorizonTemporal: false, ambientOcclusionHorizonSpatial: false }
  const bare = runHorizon({ wall: 5 }, off)
  assert.ok(bare.worst < 2e-6)
  // The integral an unoccluded surface leaves is two over π: the pass that ends the plan takes it back to one.
  assert.ok(Math.abs(Math.max(...bare.wgsl.raw.flat()) - 2 / Math.PI) < 5e-3)
  assert.ok(
    bare.wgsl.ao[18].slice(16, 48).every((v) => v > 0.99),
    `${bare.wgsl.ao[18][32]}`,
  )
  // And the two settings do something: the intensity weighs the darkening a crease leaves, the power raises it.
  const crease = (options: object) =>
    Math.min(...runHorizon(GEOMETRY, { ...off, ...options }).wgsl.ao.flat())
  const [half, full, raised] = [
    crease({ ambientOcclusionIntensity: 0.5 }),
    crease({ ambientOcclusionIntensity: 1 }),
    crease({ ambientOcclusionIntensity: 1, ambientOcclusionPower: 4 }),
  ]
  assert.ok(full < half && raised < full, `${half} ${full} ${raised}`)
  // With the filter on the same two settings are applied there: the open wall is whole either way.
  const filtered = runHorizon({ wall: 5 }, { ambientOcclusionHorizonTemporal: false })
  assert.ok(Math.abs(filtered.wgsl.ao[18][32] - bare.wgsl.ao[18][32]) < 0.01)
})

test('a pixel is reprojected by the camera’s matrix with its depth, and by its vector only where it moves by itself', () => {
  // The left half carries vectors of its own motion; the right half carries vectors that say it does not, whatever they hold.
  const own = (x: number) => x < 32
  const vectors = (x: number, y: number) =>
    encodeMotion([own(x) ? 0.01 : 0.3 * Math.sin(y), own(x) ? -0.006 : 0.3], own(x))
  // A history inside the range a small motion leaves about this image's value, so that where the history is read matters.
  const near = (x: number, y: number) => 0.93 + 0.05 * Math.sin(1.3 * x + 0.9 * y)
  const run = { history: near, shift: 0.002, rank: 5 }
  const moving = runHorizon(GEOMETRY, {}, { ...run, vectors })
  assert.ok(
    moving.worst < 2e-6,
    `the shipped reprojection against the one written apart: ${moving.worst}`,
  )
  const still = runHorizon(GEOMETRY, {}, run)
  const left = (texels: number[][]) => texels.map((row) => row.slice(0, 30))
  const right = (texels: number[][]) => texels.map((row) => row.slice(34))
  assert.ok(
    worstOf(right(moving.wgsl.ao), right(still.wgsl.ao)) < 1e-9,
    'no vector is read where none says "own"',
  )
  assert.ok(worstOf(left(moving.wgsl.ao), left(still.wgsl.ao)) > 1e-3, 'where one does, it is')
})

test('the filters and the search are the same passes written apart, through the qualities, the normals, the reduction and the filter widths', () => {
  for (const [options, run] of [
    [{}, {}],
    [
      {
        ambientOcclusionQuality: 100,
        ambientOcclusionHorizonNormals: true,
        ambientOcclusionHorizonAngles: 4,
      },
      { rank: 3 },
    ],
    [{ ambientOcclusionHorizonDownsample: true }, { history }],
    [
      { ambientOcclusionQuality: 10, ambientOcclusionHorizonFilterWidth: 3 },
      { history, shift: 0.02, rank: 7 },
    ],
    [
      { ambientOcclusionHorizonFilterWidth: 4, ambientOcclusionHorizonPauseJitter: true },
      { rank: 9 },
    ],
    [{ ambientOcclusionHorizonFilterWidth: 9, ambientOcclusionHorizonThickness: -2 }, {}],
  ] as const) {
    const chain = runHorizon(GEOMETRY, options, run)
    assert.ok(chain.worst < 2e-6, `${JSON.stringify(options)}: ${chain.worst}`)
  }
})

test('the horizon search leaves an open wall whole, darkens a crease, and fades with the distance', () => {
  const open = { ambientOcclusionHorizonTemporal: false }
  const at = (geometry: object, options = {}) => runHorizon(geometry, { ...open, ...options }).wgsl
  const wall = at({ wall: 5 }).ao
  assert.ok(
    wall[18].slice(16, 48).every((v) => v > 0.995),
    'an open wall',
  )
  const ao = at({ floor: 1.5, wall: 6 }).ao
  const crease = Math.min(...[23, 24, 25, 26, 27, 28].flatMap((y) => ao[y]))
  assert.ok(crease < 0.94 && crease > 0.5, `the crease: ${crease}`)
  assert.ok(
    ao[2].slice(16, 48).every((v) => v > 0.985),
    'the wall far from the crease',
  )
  const faded = at(
    { wall: 5 },
    { ambientOcclusionFadeDistance: 3, ambientOcclusionFadeRadius: 0.5 },
  ).ao
  assert.ok(
    faded.flat().every((v) => v === 1),
    'the wall past the fade',
  )
  const darkening = (intensity: number) =>
    1 - Math.min(...at({ floor: 1.5, wall: 6 }, { ambientOcclusionIntensity: intensity }).ao.flat())
  assert.ok(
    Math.abs(darkening(0.25) - darkening(1) / 4) < 1e-9,
    'a quarter of the intensity, a quarter of the darkening',
  )
})

test('a surface with no normal, as the G-buffer holds it where nothing was drawn, leaves the setup finite: the one guard kept', () => {
  const scene = createScene({ floor: 1.5 })
  const uniform = uniformOf(2, 0, settingsOf({ ambientOcclusionLevels: 2 }))
  const nonFinite = (text: string) => {
    const { aoSetup } = shaderRun<{ aoSetup: (at: number[]) => number[] }>(
      text,
      ['aoSetup'],
      sceneScope(scene, uniform),
    )
    let bad = 0
    for (let y = 0; y < HEIGHT / 2; y++)
      for (let x = 0; x < WIDTH / 2; x++)
        if (!aoSetup([x + 0.5, y + 0.5, 0, 1]).every(Number.isFinite)) bad++
    return bad
  }
  assert.equal(nonFinite(String(AO_SETUP_WGSL)), 0)
  // Without the guard the sky's zero normal is a NaN in every block of the setup it shares with a surface.
  const unguarded = String(AO_SETUP_WGSL).replace('select(vec3f(0.0,0.0,1.0),n/l,l>0.0)', 'n/l')
  assert.notEqual(unguarded, String(AO_SETUP_WGSL))
  assert.ok(nonFinite(unguarded) > 100)
})
