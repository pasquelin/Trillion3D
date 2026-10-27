import { MIB } from '../../../../math/src/constants.ts'
import { runtime } from './targets.fixture.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { makeTargets, targetsFit } from './targets.ts'
import { frameTargetAllocation } from './targetAllocation.ts'
import { requestFrameTargets } from './targetGrant.ts'
import { standardSurface } from '../../scene/host/graph/graph.fixture.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'
import { ensureTaaTargets } from '../../post/taa/prepare.ts'
import { frameTargetBytes } from '../../materials/surface/surfaceBuffer.ts'
import { reflectionBytes } from '../../lighting/reflections/gpu.ts'
import { level0LayerBytes } from '../../visibility/hiz/gpu/pyramid.ts'
import { taaTargetBytes } from '../../post/taa/historyTargets.ts'
import { wantedShapeOf } from '../../post/taa/historyShape.ts'
import { MEASURE_HEIGHT, MEASURE_WIDTH } from '../../../../../tests/gpu/webgpu/measureResolution.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { createScaleControl } from '../scale/scaleControl.ts'
import { createResidentSurfaces } from '../../geometry/clusters/surfaces.ts'

/** Both sizes of a frame drawn at the display's. */
const native = (width: number, height: number) => ({
  width,
  height,
  renderWidth: width,
  renderHeight: height,
  apart: false,
})

// The defect this test catches: a 288 MiB ceiling, sampled once on this Mac, refused 4K and the
// compute raster at 2496×1404 (`SURFACE_BUDGET: 415 MB > 288 MiB`, 18 Sept. 2026) on a machine that
// held them. Targets follow resolution: what they cost is published, and only
// a size the device cannot make is refused.
test('targets follow resolution, history included: 4K is admitted and costed', () => {
  const { rt, resized, temporal } = runtime()
  // The pass on: switched off, its history is not made (`ensureTaaTargets`).
  rt.gpu.temporalLevel = 'max'
  for (const [width, height] of [
    [MEASURE_WIDTH, MEASURE_HEIGHT],
    [3840, 2160],
  ]) {
    const base = frameTargetAllocation(rt, native(width, height))
    // The frame's targets, and the reflection's targets and last lit image (`lighting/reflections/gpu.ts`), and
    // the Hi-Z level 0's front layer, made with every pyramid (`level0LayerBytes`). A scene with no
    // blend: its front depth is a texel of the reflection's target.
    assert.equal(
      base,
      frameTargetBytes(width, height, true) +
        reflectionBytes(width, height, false) +
        level0LayerBytes(width, height),
    )
    // The history at the level's size, twice the display's where the device makes it.
    const shape = wantedShapeOf(rt, temporal, 'max', width, height)
    assert.equal(shape.width, 2 * width)
    assert.equal(
      ensureTaaTargets(rt, native(width, height)),
      taaTargetBytes(native(width, height), shape),
    )
  }
  assert.ok(frameTargetBytes(3840, 2160, true) > 288 * MIB, '4K exceeds the old ceiling')
  assert.deepEqual(resized, [
    [MEASURE_WIDTH, MEASURE_HEIGHT],
    [3840, 2160],
  ])
  // Reallocated targets no longer have history.
  assert.equal(temporal.frame.hasHistory, false)
  assert.throws(() => frameTargetAllocation(rt, native(8193, 16)), /SURFACE_DEVICE_LIMIT/)
})

test("a surface capture holds no pass: no history targets, and the main view's stands", () => {
  const { rt, resized } = runtime()
  rt.capture.capturing = true
  rt.gpu.temporal = undefined
  assert.equal(ensureTaaTargets(rt, native(64, 64)), 0)
  assert.deepEqual(resized, [])
})

test('a capture whose view holds the pass has its history costed and made like any view', () => {
  const { rt, temporal } = runtime()
  rt.capture.capturing = true
  rt.gpu.temporalLevel = 'max'
  const shape = wantedShapeOf(rt, temporal, 'max', 64, 64)
  assert.equal(ensureTaaTargets(rt, native(64, 64)), taaTargetBytes(native(64, 64), shape))
})

// A blended scene pays for the responsive target only when the temporal pass reads the
// responsiveness a blend carries: a debug view makes none (it made the as-is share beside it, which
// the composition no longer reads since a debug view's as-is pixels are drawn from the surfaces).
test('a blended scene costs the responsiveness only when the temporal pass reads it', () => {
  const { rt } = runtime()
  const glass = { surface: surfaceOf(standardSurface({ roughness: 0.5 })) }
  Object.assign(rt, { blendState: { blendGpu: [glass] }, vis: { ...rt.vis, asIsShown: false } })
  rt.gpu.temporalLevel = 'off'
  const base = frameTargetAllocation(rt, native(64, 32))
  rt.vis.asIsShown = true
  assert.equal(frameTargetAllocation(rt, native(64, 32)), base, 'a debug view shown costs none')
  rt.vis.asIsShown = false
  rt.gpu.temporalLevel = 'max'
  assert.equal(
    frameTargetAllocation(rt, native(64, 32)),
    base,
    'a temporal pass alone reads nothing of it',
  )
  rt.blendState.responsive = true
  assert.equal(
    frameTargetAllocation(rt, native(64, 32)),
    base + 64 * 32,
    'unless a blend carries a responsiveness: a byte a pixel',
  )
})

// Without a blend that carries a responsiveness into the temporal pass the frame targets hold no
// responsive texture and cost none; with one, it is made with them and costed (the subject was the
// as-is share a debug view read, which is gone).
test('the frame targets hold the responsiveness only while the temporal pass reads it', () => {
  const { rt } = runtime()
  const glass = { surface: surfaceOf(standardSurface({ roughness: 1 })) }
  Object.assign(rt, {
    blendState: { blendGpu: [glass], responsive: false },
    vis: { asIsShown: false },
    capture: { capturing: false },
  })
  rt.gpu.temporalLevel = 'max'
  const { device, textures } = fakeDevice({ limits: { maxTextureDimension2D: 8192 } })
  const made = (responsive: boolean) => {
    rt.blendState.responsive = responsive
    const bytes = frameTargetAllocation(rt, native(64, 32))
    textures.length = 0
    makeTargets(rt, device, native(64, 32), bytes)
    const labels = textures.map(({ label }) => label)
    return {
      bytes,
      target: labels.includes('Trillion3D current responsiveness'),
      held: !!rt.gpu.responsive,
    }
  }
  const carried = made(true)
  assert.ok(carried.target && carried.held, 'a responsive blend: the target is made')
  const plain = made(false)
  assert.ok(!plain.target && !plain.held, 'none: no responsive texture')
  assert.equal(carried.bytes - plain.bytes, 64 * 32, 'the total drops by its bytes')
})

test('targets that fit ask nothing of the device: the steady frame is free', () => {
  const scale = createScaleControl(undefined)
  const rt = {
    setup: { viewport: [32, 32] },
    run: {
      diagnostic: 'beauty',
      funding: { refreshing: undefined, cutAsked: 0, pending: Promise.resolve() },
    },
    layout: { clusters: { surfaces: createResidentSurfaces() } },
    blendState: { blendGpu: [], refracts: false, refractGranted: false },
    context: {},
    capture: { capturing: false },
    gpu: {
      colorTexture: {},
      hdrTexture: {},
      feedbackTexture: {},
      targetSize: [32, 32],
      allocatedSize: [32, 32],
      displaySize: [32, 32],
      surfaces: { width: 32, height: 32, hasSubsurface: false },
      reflection: { front: { wanted: false } },
      targetGrant: undefined,
    },
    vis: { visTexture: {} },
    views: { active: { scale } },
  } as unknown as WebgpuPagesRuntime
  // A bare device: any creation or error scope would throw.
  assert.equal(requestFrameTargets(rt, {} as GPUDevice), undefined)
})

// Every pass up to the resolve draws at the render size; the display colour is apart. S11:
// no water, no render-size display colour (`displayColor.test.ts`).
test('a frame drawn below the display costs its render targets and the display colour', () => {
  const { rt } = runtime()
  const scaled = { width: 64, height: 32, renderWidth: 32, renderHeight: 16, apart: true }
  assert.equal(
    frameTargetAllocation(rt, scaled),
    frameTargetAllocation(rt, native(32, 16)) - 32 * 16 * 4 + 64 * 32 * 4,
  )
  Object.assign(rt.gpu, {
    hdrTexture: {},
    displayTexture: {},
    surfaces: { width: 32, height: 16, hasSubsurface: false },
    reflection: { front: { wanted: false } },
    feedbackTexture: {},
    allocatedSize: [32, 16],
    displaySize: [64, 32],
  })
  Object.assign(rt, { feedbackAB: undefined, vis: { visTexture: {} } })
  assert.equal(targetsFit(rt, scaled), true)
  assert.equal(targetsFit(rt, native(64, 32)), false, 'the same display at native size is remade')
})

// The render targets follow the drawn size; the render scale crossing an eighth remade them
// and dropped the display's temporal history with them.
test('a new render size at the same display keeps the temporal history, a new display drops it', () => {
  const { rt, temporal } = runtime()
  Object.assign(rt, { vis: {}, capture: { capturing: false } })
  rt.gpu.temporalLevel = 'max'
  let released = 0
  temporal.release = () => void released++
  const make = (renderWidth: number, width = 64) => {
    const at = { width, height: 32, renderWidth, renderHeight: 16, apart: true }
    makeTargets(rt, rt.gpu.device!, at, frameTargetAllocation(rt, at))
  }
  make(48)
  assert.equal(released, 1, 'the first targets start a history')
  make(32)
  assert.equal(released, 1, 'the render size alone: the history stays')
  make(32, 128)
  assert.equal(released, 2, 'another display size: the history goes')
})
