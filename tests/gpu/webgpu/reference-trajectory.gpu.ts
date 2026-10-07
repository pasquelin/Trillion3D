// The WebGPU page raster walks the bench trajectory of the reference scene at the measurement
// resolution, temporal antialiasing on as the bench draws it: one pose per trajectory point, each
// settled and its image read back, with the real visibility buffer and no render failure, no lost
// device, on the way.
import test from 'node:test'
import assert from 'node:assert/strict'
import { FRAMES_PER_SEGMENT, PATH_POSES, poseAt } from '../../../bench/runner/trajectory/poses.ts'
import { DEFAULT_SCENE } from '../../../bench/runner/assets/scene.ts'
import type { EngineDiagnostic } from '../../../packages/sdk-browser/src/engine/types.ts'
import { MEASURE_HEIGHT, MEASURE_WIDTH } from './measureResolution.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { openEngineWorld, proofCanvas } from '../kit/renderHarness.ts'
import { benchManifest, drawnPixels, settle } from '../world/proofWorld.ts'

/** One reading per trajectory point: the first frame of each segment. */
const POINTS = Math.ceil(PATH_POSES / FRAMES_PER_SEGMENT)

async function walkTheTrajectory() {
  const events: EngineDiagnostic[] = []
  const world = await openEngineWorld(proofCanvas('trajectory'), {
    manifestUrl: benchManifest(DEFAULT_SCENE),
    scope: 'full',
    width: MEASURE_WIDTH,
    height: MEASURE_HEIGHT,
    pixelRatio: 1,
    pixelError: 1,
    maxResidentPages: 100000,
    preload: 'visible',
    textureSource: 'cache',
    temporalAntialiasing: true,
    clearColor: 0x2a303c,
    onDiagnostic: (event) => void events.push(event),
  })
  try {
    const readings = []
    for (let point = 0; point < POINTS; point++) {
      const pose = poseAt(world.bounds, point * FRAMES_PER_SEGMENT)
      world.setPose(pose)
      await world.awaitPages()
      const held = await settle(world)
      const pixels = new Uint8Array(await world.capture())
      readings.push({
        point,
        held: held !== null,
        drawn: drawnPixels(pixels) / (pixels.length / 4),
      })
    }
    return { readings, events }
  } finally {
    world.dispose()
  }
}

test('the WebGPU page raster walks the reference trajectory', { timeout: 600_000 }, async () => {
  const errors: string[] = []
  const { readings, events } = await runOnDawn(walkTheTrajectory, null, errors)
  console.log(JSON.stringify(readings))
  assert.deepEqual(errors, [])
  assert.equal(readings.length, POINTS)
  for (const { point, held } of readings) assert.ok(held, `trajectory point ${point} is held`)
  const failures = events.filter((event) => /failed|gpu-device-lost/.test(event.phase))
  assert.deepEqual(failures, [], 'no render diagnostic reports a failure')
  // The visibility buffer is the engine's one draw path: a prepare that cannot make it refuses by
  // name, and only a prepared one says its render paths ready.
  assert.ok(
    events.some(
      (event) =>
        event.phase === 'render-capabilities' && event.context?.temporalAntialiasing === true,
    ),
    'the real visibility buffer draws the frames, temporal antialiasing on',
  )
})
