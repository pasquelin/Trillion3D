import { REFLECTION_SOURCE_VIEW_BYTES } from '../../../reflections/sourceWgsl.ts'
import { runtime } from './targets.fixture.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts'
import { makeTargets, targetsFit } from './targets.ts'
import { frameTargetAllocation } from './targetAllocation.ts'
import { requestFrameTargets } from './targetGrant.ts'
import { standardSurface } from '../../../host/graph/graph.fixture.ts'
import { surfaceOf } from '../../../page/surface.ts'
import { ensureTaaTargets } from '../../../taa/prepare.ts'
import { frameTargetBytes } from '../../../scene/surfaceBuffer.ts'
import { TAA_HISTORY_BYTES_PER_PIXEL } from '../../../taa/temporalAntialiasing.ts'
import {
  MEASURE_HEIGHT,
  MEASURE_WIDTH,
} from '../../../../../../tests/gpu/webgpu/measureResolution.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { createScaleControl } from '../../../frame/scaleControl.ts'

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
  rt.gpu.temporalWanted = true
  for (const [width, height] of [
    [MEASURE_WIDTH, MEASURE_HEIGHT],
    [3840, 2160],
  ]) {
    const base = frameTargetAllocation(rt, native(width, height))
    assert.equal(base, frameTargetBytes(width, height, true) + 8 + 80)
    assert.equal(ensureTaaTargets(rt, width, height), width * height * TAA_HISTORY_BYTES_PER_PIXEL)
  }
  assert.ok(frameTargetBytes(3840, 2160, true) > 288 * 1024 * 1024, '4K exceeds the old ceiling')
  assert.deepEqual(resized, [
    [MEASURE_WIDTH, MEASURE_HEIGHT],
    [3840, 2160],
  ])
  // Reallocated targets no longer have history.
  assert.equal(temporal.frame.hasHistory, false)
  assert.equal(temporal.frame.stillFrames, 0)
  assert.throws(() => frameTargetAllocation(rt, native(8193, 16)), /SURFACE_DEVICE_LIMIT/)
})

test("a surface capture does not touch the view's history targets", () => {
  const { rt, resized } = runtime()
  rt.capture.capturing = true
  assert.equal(ensureTaaTargets(rt, 64, 64), 0, 'the capture reserve already carries the history')
  assert.deepEqual(resized, [])
})

test('an eligible receiver accounts for viewport reflection colour, its uniform and the bounds its mirror ray walks', () => {
  const { rt } = runtime(true)
  // A mirror's ray walks the depth bounds (`reflectionPlan`): 32×16 down to 1×1 in rg32float, and
  // a uniform block a level; no radiance levels, no cone reads them.
  const bounds = (512 + 128 + 32 + 8 + 2 + 1) * 8 + 6 * 256
  assert.equal(
    frameTargetAllocation(rt, native(64, 32)),
    frameTargetBytes(64, 32, true) + 64 * 32 * 24 + REFLECTION_SOURCE_VIEW_BYTES + 80 + bounds,
  )
})

// #365: a blended scene pays for the share target only when a debug view or the temporal pass reads it.
test('a blended scene costs the share only when a debug view or the temporal pass reads it', () => {
  const { rt } = runtime()
  // Extra levels: 32×16, 16×8, 8×4, 4×2, 2×1, 1×1 for color and depth bounds.
  const cone = (512 + 128 + 32 + 8 + 2 + 1) * 16 + 12 * 256
  const base =
    frameTargetAllocation(rt, native(64, 32)) +
    64 * 32 * 24 -
    8 +
    REFLECTION_SOURCE_VIEW_BYTES +
    cone
  // Under the screen-reflection cutoff (#1341), above the mirror range: the cone's lobe.
  const glass = { surface: surfaceOf(standardSurface({ roughness: 0.5 })) }
  Object.assign(rt, { blendState: { blendGpu: [glass] }, vis: { ...rt.vis, asIsShown: false } })
  assert.equal(
    frameTargetAllocation(rt, native(64, 32)),
    base,
    'forward reflection source and cone hierarchy, no opaque history',
  )
  rt.vis.asIsShown = true
  assert.equal(frameTargetAllocation(rt, native(64, 32)), base + 64 * 32 * 2, 'a debug view shown')
  rt.vis.asIsShown = false
  rt.gpu.temporalWanted = true
  assert.equal(frameTargetAllocation(rt, native(64, 32)), base + 64 * 32 * 2, 'its reactive value')
})

// #1162: with no debug view the frame targets hold no share texture and cost none; with one, the
// share is made with them and costed.
test('the frame targets hold the share only while a debug view reads it', () => {
  const { rt } = runtime()
  const glass = { surface: surfaceOf(standardSurface({ roughness: 1 })) }
  Object.assign(rt, {
    blendState: { blendGpu: [glass] },
    vis: { asIsShown: false },
    capture: { capturing: false },
  })
  const { device, textures } = fakeDevice({ limits: { maxTextureDimension2D: 8192 } })
  const made = (shown: boolean) => {
    rt.vis.asIsShown = shown
    const bytes = frameTargetAllocation(rt, native(64, 32))
    textures.length = 0
    makeTargets(rt, device, native(64, 32), bytes)
    const labels = textures.map(({ label }) => label)
    return {
      bytes,
      share: labels.includes('Trillion3D current as-is share'),
      held: !!rt.gpu.asIsShare,
    }
  }
  const shown = made(true)
  assert.ok(shown.share && shown.held, 'a debug view: the share is made')
  const plain = made(false)
  assert.ok(!plain.share && !plain.held, 'no debug view: no share texture')
  assert.equal(shown.bytes - plain.bytes, 64 * 32 * 2, 'the total drops by its bytes')
})

test('targets that fit ask nothing of the device: the steady frame is free', () => {
  const rt = {
    setup: { viewport: [32, 32] },
    run: { diagnostic: 'beauty' },
    layout: { rows: { packedCount: 0, packedRecs: [] } },
    blendState: { blendGpu: [] },
    context: {},
    gpu: {
      colorTexture: {},
      hdrTexture: {},
      feedbackTexture: {},
      targetSize: [32, 32],
      allocatedSize: [32, 32],
      displaySize: [32, 32],
      surfaces: { width: 32, height: 32, subsurface: { width: 1, height: 1 } },
      reflection: { active: false },
      targetGrant: undefined,
    },
    vis: { visTexture: {} },
    scale: createScaleControl(undefined),
  } as unknown as WebgpuPagesRuntime
  // A bare device: any creation or error scope would throw.
  assert.equal(requestFrameTargets(rt, {} as GPUDevice), undefined)
})

// #816: every pass up to the resolve draws at the render size; the display colour is apart. S11:
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
    surfaces: { width: 32, height: 16, subsurface: { width: 1, height: 1 } },
    feedbackTexture: {},
    reflection: { active: false },
    allocatedSize: [32, 16],
    displaySize: [64, 32],
  })
  Object.assign(rt, { feedbackAB: undefined, vis: { visTexture: {} } })
  assert.equal(targetsFit(rt, scaled), true)
  assert.equal(targetsFit(rt, native(64, 32)), false, 'the same display at native size is remade')
})

// #1343: the render targets follow the drawn size; the render scale crossing an eighth remade them
// and dropped the display's temporal history with them.
test('a new render size at the same display keeps the temporal history, a new display drops it', () => {
  const { rt, temporal } = runtime()
  Object.assign(rt, { vis: {}, capture: { capturing: false } })
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
