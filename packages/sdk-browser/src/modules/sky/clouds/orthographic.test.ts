// An orthographic view's clouds and the depth the tracing reads the scene at: the ray of a pixel of
// an orthographic view starts at the pixel's own point on the near plane and runs along the view's
// direction (the same for every pixel), its depth measured from there; the composition lays the
// directly traced image of such a view; the last coordinate the scene's depth is read at is that of
// the depth image the tracing reads, in every size mode. Split from `trace.test.ts`, which holds the
// march's tests (300 lines at most a file).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { resolveCloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'
import { SKY_QUALITY_RULES } from '../../../../../sdk-core/src/modules/sky/quality.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { cloudSetupOf } from './cloudModes.ts'
import { composeProgram } from './composeWgsl.ts'
import { advanceCloudView, createCloudViewState } from './reconstruct.ts'
import { CLOUD_TRACE_LAYOUT, writeCloudTrace } from './traceLayout.ts'
import { cloudTraceProgram } from './traceWgsl.ts'
import type { CloudTraceKey } from './traceExtraLayout.ts'

const QUALITY = resolveSettings(SKY_QUALITY_RULES, {})
const KEY: CloudTraceKey = {
  depth: 'scene',
  minMaxDepth: false,
  emptySpace: false,
  opaqueShadow: false,
  localLights: false,
  skyLight: false,
  volumeShadowMap: false,
  closestDepth: false,
}

/** An orthographic view looking straight down over the planet: its pixels' rays leave the plane of
 *  the eye (device depth 1) at `ndc` times 1000 m across, and the far plane (depth 0) is `far`
 *  metres below it. */
const downward = (far: number) => (ndc: number[], z: number) => [
  ndc[0] * 1000,
  (z - 1) * far,
  ndc[1] * 1000,
]

test('an orthographic view traces a ray from each pixel’s own point along the view’s direction', () => {
  const { cloudViewRay } = shaderRun<{
    cloudViewRay: (ndc: number[]) => { origin: number[]; dir: number[] }
  }>(cloudTraceProgram(KEY), ['cloudViewRay'], {
    frame: { eye: [5, 6, 7, 0] },
    cloudUnproject: downward(1e6),
  })
  const left = cloudViewRay([-0.5, 0.25])
  const right = cloudViewRay([0.5, -0.25])
  assert.deepEqual(
    [left.origin, right.origin],
    [
      [-500, 0, 250],
      [500, 0, -250],
    ],
  )
  assert.deepEqual(
    [left.dir, right.dir],
    [
      [0, -1, 0],
      [0, -1, 0],
    ],
    'one direction for every pixel',
  )
})

test('a perspective view traces a ray from the eye through each pixel', () => {
  const { cloudViewRay } = shaderRun<{
    cloudViewRay: (ndc: number[]) => { origin: number[]; dir: number[] }
  }>(cloudTraceProgram(KEY), ['cloudViewRay'], {
    frame: { eye: [0, 0, 0, 1] },
    cloudUnproject: downward(1e6),
  })
  const ray = cloudViewRay([0.5, 0])
  assert.deepEqual(ray.origin, [0, 0, 0])
  assert.ok(Math.abs(ray.dir[0] - 500 / Math.hypot(500, 500000)) < 1e-9)
})

/** The trace of one pixel of a view looking down from `height` kilometres over the planet's centre
 *  (the layer from 6362 to 6372 km), the scene's depth cutting the ray at `sceneCm`: the points the
 *  march was moved to, the ray it was given (none when it was not marched). */
function traceDown(orthographic: boolean, height: number, far: number, sceneCm: number) {
  const moved: number[][] = []
  let marched: { origin: number[]; dir: number[]; tMin: number; tMax: number } | undefined
  const { cloudRayTrace } = shaderRun<{ cloudRayTrace: (p: number[]) => object }>(
    cloudTraceProgram(KEY),
    ['cloudRayTrace'],
    {
      frame: {
        eye: [0, 0, 0, orthographic ? 0 : 1],
        camera: [0, height, 0, height],
        size: [1, 1, 1, 1],
      },
      cloudTrace: {
        counts: [0, 0, 0, 1],
        layer: [2, 10, 0, 0.05],
        reach: [1e12, 0, 1e12, 1],
        options: [0, 0, 1, 0],
        local: [0, 0, 0, 0],
        sky: [0, 0, 0, 1],
      },
      bottomRadius: () => 6360,
      cloudNdc: (p: number[]) => [p[0], p[1]],
      ndcToPixel: (ndc: number[]) => ndc,
      cloudUnproject: downward(far),
      cloudMoveOrigin: (origin: number[]) => moved.push(origin),
      cloudSceneDepth: () => ({ closestCm: sceneCm, furthestCm: sceneCm, km: [1, 1, 1, 1] }),
      cloudMaxDistance: () => true,
      cloudMarch: (r: NonNullable<typeof marched>) => ((marched = r), { seen: {}, nearest: {} }),
      cloudMeanDepth: () => 0,
      cloudFinish: () => [0, 0, 0, 0.5],
      cloudLight: (colour: number[]) => colour,
    },
  )
  cloudRayTrace([0.5, 0.5])
  return { moved, marched }
}

test('an orthographic view whose pixel starts inside the layer’s outer sphere shows no cloud', () => {
  assert.equal(traceDown(true, 6365, 1e7, 1e15).marched, undefined)
  assert.ok(traceDown(false, 6365, 1e7, 1e15).marched, 'a perspective view marches from there')
})

test('an orthographic ray starts at its pixel, not at the eye', () => {
  const { moved, marched } = traceDown(true, 8000, 1e7, 1e15)
  assert.deepEqual(moved, [[0.5 * 1000, 0, 0.5 * 1000]])
  // 1 km across and above the planet's centre by the view's height: the ray's origin in kilometres.
  assert.deepEqual(marched?.origin, [0.5, 8000, 0.5])
  assert.deepEqual(marched?.dir, [0, -1, 0])
})

test('the scene’s depth cuts an orthographic ray only where the layer ends before the far plane', () => {
  // The layer lies 1628 to 1638 km down the ray (1.628e8 to 1.638e8 cm), the scene's depth 1630 km
  // down it; the far plane is 10000 km down, or 1000 km down.
  const near = traceDown(true, 8000, 1e7, 1.63e8).marched
  const far = traceDown(true, 8000, 1e6, 1.63e8).marched
  assert.equal(near?.tMax, 1.63e8, 'the layer ends before the far plane: cut by the scene')
  assert.ok((far?.tMax ?? 0) > 1.635e8, 'the layer reaches past the far plane: not cut')
  assert.equal(
    traceDown(false, 8000, 1e6, 1.63e8).marched?.tMax,
    1.63e8,
    'a perspective view always',
  )
})

test('the last coordinate the tracing reads the scene’s depth at is the depth image’s own, in every mode', () => {
  // The depth image is the view's size for the quarter-to-full and full traces and a direct one,
  // half of it for the others: mode 2 traces at a quarter, and still reads the full-size depth.
  const view = { width: 1920, height: 1080 }
  const last = (settings: object) => {
    const quality = { ...QUALITY, ...settings }
    const setup = cloudSetupOf(quality)
    const plan = advanceCloudView(createCloudViewState(), view, view, false, setup)
    const out = new Float32Array(CLOUD_TRACE_LAYOUT.words)
    const image = {
      inverseView: new Float32Array(16),
      view,
      frameIndex: 0,
      time: 0,
      airPresent: true,
      lightScales: [
        [1, 1, 1],
        [1, 1, 1],
      ] as const,
    }
    writeCloudTrace(out, image, plan, resolveCloudPart({}, quality))
    const words = new Uint32Array(out.buffer)
    return [words[CLOUD_TRACE_LAYOUT.at.sizes + 2], words[CLOUD_TRACE_LAYOUT.at.sizes + 3]]
  }
  assert.deepEqual(last({ cloudTraceSize: 'quarterToHalf' }), [959, 539], 'half-size depth')
  assert.deepEqual(last({ cloudTraceSize: 'half' }), [959, 539], 'half-size depth')
  assert.deepEqual(last({ cloudTraceSize: 'quarterToFull' }), [1919, 1079], 'full-size depth')
  assert.deepEqual(last({ cloudTraceSize: 'full' }), [1919, 1079], 'full-size depth')
  assert.deepEqual(last({ cloudRenderTarget: false }), [1919, 1079], 'a direct trace')
})

test('an orthographic view’s clouds are laid over the image: only the ways that enlarge a reduced image refuse it', () => {
  const ortho = cloudSetupOf(QUALITY, true, false)
  assert.equal(ortho.direct, true, 'an orthographic view is traced directly')
  assert.ok(!composeProgram(ortho).includes('frame.eye.w==0.0'), 'the direct composition draws')
  const enlarged = composeProgram(cloudSetupOf(QUALITY))
  assert.ok(enlarged.includes('if(frame.eye.w==0.0){discard;}'), 'the others read the eye’s rays')
})
