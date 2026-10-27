import test from 'node:test'
import assert from 'node:assert/strict'
import {
  lightsPerTile,
  MAX_LIGHTS_PER_TILE,
} from '../../../../../sdk-core/src/lighting/surfaceCache/lightingMath.ts'
import {
  CONTEXT_ARGS,
  CONTEXT_AT,
  CONTEXT_HEADER_WORDS,
  contextLayout,
  LIGHTING_FLAG,
  LIGHTING_PARAMS,
  tracedShadowWords,
} from './layout.ts'
import { shapeKey, shapeOf, sizesOf, tracedRaysFit, writeLightingParams } from './params.ts'
import { lightingSettings as settings, near } from './params.fixture.ts'

test('the lighting is sized by the reference defaults: an atlas of 4096 lights 8281 tiles directly and 4096 by radiosity', () => {
  const shape = shapeOf(settings, 4096, false)
  assert.equal(shape.directTiles, 91 ** 2)
  assert.equal(shape.indirectTiles, 64 ** 2)
  assert.equal(shape.maxLights, 8)
  assert.equal(shape.spacing, 4)
  assert.equal(shape.hemisphere, 4)
  // A probe a tile of 4 × 4 texels: four to a tile of the cards' tiles.
  assert.equal(shape.radiosityTiles, 4 * 64 ** 2)
  assert.equal(shape.probesPerTile, 1)
  assert.equal(shape.raysPerProbe, 16)
})

test('the memory follows the shape: the probes at the spacing, a square of rays a probe', () => {
  const sizes = sizesOf(shapeOf(settings, 4096, false))
  assert.equal(sizes.probeAtlas, 1024)
  assert.equal(sizes.traceAtlas, 4096)
  assert.equal(sizes.tileLightsWords, 91 ** 2 * 9)
  assert.equal(sizes.filteredWords, 4 * 64 ** 2 * 16)
  // The lists follow the header, one after the other.
  const layout = contextLayout(10, 20, 30)
  assert.deepEqual(
    [layout.directAt, layout.indirectAt, layout.radiosityAt, layout.words],
    [
      CONTEXT_HEADER_WORDS,
      CONTEXT_HEADER_WORDS + 10,
      CONTEXT_HEADER_WORDS + 30,
      CONTEXT_HEADER_WORDS + 60,
    ],
  )
  assert.ok(
    CONTEXT_AT.args + Object.keys(CONTEXT_ARGS).length * 4 <= CONTEXT_HEADER_WORDS,
    'the dispatch arguments are in the header',
  )
  // Without radiosity nothing of it is made.
  const off = sizesOf(shapeOf({ ...settings, surfaceCacheRadiosity: false }, 4096, false))
  assert.deepEqual([off.probeAtlas, off.traceAtlas, off.filteredWords], [1, 1, 1])
})

test('a spacing under 4 puts a whole card tile in a radiosity tile, its probes many', () => {
  const shape = shapeOf({ ...settings, surfaceCacheRadiosityProbeSpacing: 2 }, 4096, false)
  assert.equal(shape.radiosityTiles, shape.indirectTiles)
  assert.equal(shape.probesPerTile, 16)
})

/** The world-to-clip matrix, column-major, of a camera at `eye` metres looking down -Z with a quarter turn of view, depth
 *  reversed with no far plane (`ndc = near / distance`). */
function viewProjection(eye: readonly number[], near = 0.1) {
  const projection = new Float64Array(16)
  projection[0] = 1
  projection[5] = 1
  projection[14] = near
  projection[11] = -1
  const m = new Float64Array(projection)
  for (let row = 0; row < 4; row++)
    m[12 + row] =
      projection[12 + row] -
      (projection[row] * eye[0] + projection[4 + row] * eye[1] + projection[8 + row] * eye[2])
  return m
}

/** The distance outside plane `k` of the point `q` centimetres from the eye. */
const outside = (planes: Float32Array, k: number, q: readonly number[]) =>
  planes[4 * k] * q[0] + planes[4 * k + 1] * q[1] + planes[4 * k + 2] * q[2] + planes[4 * k + 3]

/** The five planes of the frustum of a camera at `eye` as the parameters hold them. */
function planesOf(eye: readonly number[]) {
  const words = new Uint32Array(LIGHTING_PARAMS.words)
  writeLightingParams(words, shapeOf(settings, 1024, false), settings, {
    frame: 1,
    pages: 1,
    eye,
    viewProjection: viewProjection(eye),
    preExposure: 1,
    viewPreExposure: 1,
    firstClipmapExtent: 2500,
    historyLost: false,
    feedback: false,
  })
  return new Float32Array(words.buffer, LIGHTING_PARAMS.at.frustum * 4, 20)
}

test('the frustum planes are outward, in centimetres from the eye, whatever the eye', () => {
  for (const eye of [
    [0, 0, 0],
    [30, -4, 12.5],
  ]) {
    const planes = planesOf(eye)
    // A point ahead is inside every plane (left, right, bottom, top, near).
    const ahead = [0, 0, -1000]
    for (let k = 0; k < 5; k++) assert.ok(outside(planes, k, ahead) < 0, `ahead, plane ${k}`)
    // Past each side it is outside that plane alone, by its distance to it.
    near(outside(planes, 0, [-1000, 0, -500]), 500 / Math.SQRT2, 1e-2)
    near(outside(planes, 1, [1000, 0, -500]), 500 / Math.SQRT2, 1e-2)
    near(outside(planes, 2, [0, -1000, -500]), 500 / Math.SQRT2, 1e-2)
    near(outside(planes, 3, [0, 1000, -500]), 500 / Math.SQRT2, 1e-2)
    // Behind the eye is outside the near plane, 10 cm in front of it is the plane.
    assert.ok(outside(planes, 4, [0, 0, 500]) > 0)
    near(outside(planes, 4, [0, 0, -10]), 0, 1e-2)
  }
})

test("an image's parameters carry the settings: the flags, the pre-exposed ray limit, the eye in both units", () => {
  const shape = shapeOf(settings, 1024, false)
  const words = new Uint32Array(LIGHTING_PARAMS.words)
  writeLightingParams(words, shape, settings, {
    frame: 9,
    pages: 12,
    eye: [1, 2, 3],
    viewProjection: viewProjection([1, 2, 3]),
    preExposure: 0.5,
    viewPreExposure: 0.25,
    firstClipmapExtent: 2500,
    historyLost: false,
    feedback: true,
  })
  const floats = new Float32Array(words.buffer)
  const at = LIGHTING_PARAMS.at
  assert.equal(words[at.frame], 9)
  assert.equal(words[at.pages], 12)
  assert.equal(words[at.maxLights], 8)
  assert.equal(words[at.spacingShift], 2)
  assert.equal(words[at.maxFrames], 4)
  assert.equal(new Int32Array(words.buffer)[at.fixedJitter], -1)
  near(floats[at.firstClipmapRcp], 1 / 2500)
  near(floats[at.maxRayIntensity], 160)
  near(floats[at.camera + 2], 300)
  near(floats[at.eye + 2], 3)
  near(floats[at.maxTrace], 20000)
  const all =
    LIGHTING_FLAG.direct |
    LIGHTING_FLAG.radiosity |
    LIGHTING_FLAG.prioritizeFrustum |
    LIGHTING_FLAG.filter |
    LIGHTING_FLAG.temporal |
    LIGHTING_FLAG.planeWeighting |
    LIGHTING_FLAG.historyValid |
    LIGHTING_FLAG.adaptiveShadowTracing |
    LIGHTING_FLAG.feedback
  assert.equal(words[at.flags], all)
  // The traced shadow's biases, in centimetres: the reference's defaults.
  near(floats[at.traceRayBias], 1)
  near(floats[at.traceEndBias], 1)
  // A lost history clears its flag; no prioritising near the frustum is the setting -1.
  writeLightingParams(
    words,
    shape,
    { ...settings, surfaceCacheLightingMaxDistanceFromFrustumToPrioritize: -1 },
    {
      frame: 1,
      pages: 1,
      eye: [0, 0, 0],
      viewProjection: viewProjection([0, 0, 0]),
      preExposure: 1,
      viewPreExposure: 1,
      firstClipmapExtent: 2500,
      historyLost: true,
      feedback: true,
    },
  )
  assert.equal(
    words[at.flags],
    all & ~LIGHTING_FLAG.historyValid & ~LIGHTING_FLAG.prioritizeFrustum,
  )
})

test('the frozen update frame and the two-sided shadow rays are flags of the settings, the adaptive tracing one off', () => {
  const words = new Uint32Array(LIGHTING_PARAMS.words)
  writeLightingParams(
    words,
    shapeOf(settings, 1024, false),
    {
      ...settings,
      surfaceCacheFreezeUpdateFrame: 1,
      surfaceCacheDirectLightingHardwareRayTracingForceTwoSided: true,
      surfaceCacheDirectLightingHardwareRayTracingAdaptiveShadowTracing: false,
    },
    {
      frame: 1,
      pages: 1,
      eye: [0, 0, 0],
      viewProjection: viewProjection([0, 0, 0]),
      preExposure: 1,
      viewPreExposure: 1,
      firstClipmapExtent: 2500,
      historyLost: false,
      feedback: false,
    },
  )
  const flags = words[LIGHTING_PARAMS.at.flags]
  assert.ok(flags & LIGHTING_FLAG.freezeUpdateFrame)
  assert.ok(flags & LIGHTING_FLAG.forceTwoSided)
  assert.equal(flags & LIGHTING_FLAG.adaptiveShadowTracing, 0)
})

test('the traced rays fit only where every buffer — the shadows’ masks, traces and light tiles, the scene trace’s nodes, triangles and table — fits a binding and a buffer of the device', () => {
  const shape = shapeOf(settings, 4096, false)
  const lightTiles = shape.directTiles * shape.maxLights
  const roomy = { maxStorageBufferBindingSize: 2 ** 30, maxBufferSize: 2 ** 30 }
  const scene = { nodes: 1000, triangles: 2000, table: 500 }
  assert.equal(tracedRaysFit(roomy, lightTiles, scene), true)
  // The traces are the largest buffer: one word for each texel of each light tile.
  const words = tracedShadowWords(lightTiles)
  const bytes = words.traces * 4
  assert.ok(bytes > words.masks * 4 && bytes > words.lightTiles * 4)
  const binding = { ...roomy, maxStorageBufferBindingSize: bytes }
  assert.equal(tracedRaysFit(binding, lightTiles, scene), true)
  assert.equal(
    tracedRaysFit({ ...binding, maxStorageBufferBindingSize: bytes - 4 }, lightTiles, scene),
    false,
  )
  assert.equal(tracedRaysFit({ ...roomy, maxBufferSize: bytes - 4 }, lightTiles, scene), false)
  // Each of the scene trace's buffers decides alone, to the word.
  const full = bytes / 4
  assert.equal(
    tracedRaysFit(binding, lightTiles, { nodes: full, triangles: full, table: full }),
    true,
  )
  for (const name of ['nodes', 'triangles', 'table'] as const)
    assert.equal(tracedRaysFit(binding, lightTiles, { ...scene, [name]: full + 1 }), false, name)
})

test('the traced shadows’ sizes are one list: the buffers are made at it and the fit is checked against it', () => {
  // 16 words of masks a light tile, a trace for each of the 64 texels of each, two words a light tile.
  assert.deepEqual(tracedShadowWords(100), { masks: 1600, traces: 1 + 64 * 100, lightTiles: 200 })
  const sceneSmall = { nodes: 1, triangles: 1, table: 1 }
  const most = Math.max(...Object.values(tracedShadowWords(100))) * 4
  const limits = { maxStorageBufferBindingSize: most, maxBufferSize: most }
  assert.equal(tracedRaysFit(limits, 100, sceneSmall), true)
  assert.equal(tracedRaysFit({ ...limits, maxBufferSize: most - 4 }, 100, sceneSmall), false)
  // The radiosity traced alone: the scene trace's buffers decide, no shadow buffer being made.
  assert.equal(tracedRaysFit({ ...limits, maxBufferSize: 4 }, 0, sceneSmall), true)
  assert.equal(
    tracedRaysFit({ ...limits, maxBufferSize: 4 }, 0, { ...sceneSmall, nodes: 2 }),
    false,
  )
})

test('the shape names nothing of the traced shadows: turning them on or off keeps the lighting’s resources', () => {
  const shape = shapeOf(settings, 4096, false)
  assert.ok(!('traced' in shape))
  const direct = { ...settings, surfaceCacheDirectLighting: !settings.surfaceCacheDirectLighting }
  const traced = {
    ...settings,
    surfaceCacheDirectLightingHardwareRayTracing:
      !settings.surfaceCacheDirectLightingHardwareRayTracing,
  }
  assert.equal(shapeKey(shapeOf(direct, 4096, false)), shapeKey(shape))
  assert.equal(shapeKey(shapeOf(traced, 4096, false)), shapeKey(shape))
})

test('a tile’s lights are counted in arrays of the most a tile keeps', () => {
  assert.equal(MAX_LIGHTS_PER_TILE, lightsPerTile(1000))
})
