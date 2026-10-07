// An interactive session on Dawn: opened on a canvas by its id, it sizes its drawing buffer from
// the canvas's CSS box and the device pixel ratio, draws on the WebGPU page raster, settles, and
// then schedules no frame at all; a drag moves the camera and it settles again; a new pixel ratio
// resizes it; once disposed, a resize schedules nothing. Then the targets and the job and abort
// paths (`sessionTargets.ts`). A box hidden or sized by its own drawing buffer needs a layout the
// bench's page does not compute (`world/session/interactive.ts` reads `clientWidth`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { measureOutput } from '../../../bench/core/paths.ts'
import type { EngineDiagnostic } from '../../../packages/sdk-browser/src/engine/types.ts'
import type { MeasuredWorld } from '../../../packages/sdk-browser/src/world/session/explorer.ts'
import { drag } from '../camera/cameraGestures.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { measurementSdk, proofCanvas, threeStackCache } from '../kit/renderHarness.ts'
import { sessionTargets } from './sessionTargets.ts'

/** Counts the animation frames the page is asked for until `restore`: the session's loop asks one
 *  for every frame it schedules, and none once still. */
function countFrames() {
  const request = globalThis.requestAnimationFrame
  const counted = { asked: 0, restore: () => void (globalThis.requestAnimationFrame = request) }
  globalThis.requestAnimationFrame = (callback) => (counted.asked++, request(callback))
  return counted
}

/** Whether `world`'s loop comes to rest within 30 s: its frame held, and no frame asked for the
 *  400 ms after. A gesture's first frames may still be on their way when it is read. */
async function stillAfter(world: MeasuredWorld, frames: { asked: number }) {
  for (const end = performance.now() + 30_000; performance.now() < end; await sleep(16)) {
    if (!world.engine.metrics().frameHeld) continue
    const before = frames.asked
    await sleep(400)
    if (frames.asked === before) return true
  }
  return false
}

const eye = ({ camera: { position } }: MeasuredWorld) => [position.x, position.y, position.z]

async function startInteractive() {
  const { openMeasuredWorld } = await measurementSdk()
  const { manifestUrl } = threeStackCache(measureOutput('gpu-proofs', 'session-startup'))
  const viewer = proofCanvas('viewer')
  const frames = countFrames()
  const ratio = globalThis.devicePixelRatio
  globalThis.devicePixelRatio = 2
  const diagnostics: EngineDiagnostic[] = []
  try {
    const world = await openMeasuredWorld('viewer', {
      manifestUrl,
      scope: 'full',
      interactive: true,
      onDiagnostic: (event) => void diagnostics.push(event),
    })
    const opened = {
      box: [viewer.clientWidth, viewer.clientHeight],
      size: [world.canvas.width, world.canvas.height],
      controlsReused: world.controls() === world.controls(),
      coverageReady: world.engine.metrics().coverageReady,
    }
    const startedStill = await stillAfter(world, frames)
    const home = eye(world)
    drag(viewer, [230, 100], 60, 25)
    const dragged = {
      moved: eye(world).some((v, i) => v !== home[i]),
      still: await stillAfter(world, frames),
    }
    globalThis.devicePixelRatio = 1
    window.dispatchEvent(new Event('resize'))
    const resized = {
      size: [world.canvas.width, world.canvas.height],
      still: await stillAfter(world, frames),
    }
    world.dispose()
    const before = frames.asked
    window.dispatchEvent(new Event('resize'))
    await sleep(80)
    const stopped = frames.asked === before
    const targets = await sessionTargets(manifestUrl, viewer)
    const interactive = diagnostics.filter((event) => /interactive-/.test(event.phase))
    return { opened, startedStill, dragged, resized, stopped, targets, interactive }
  } finally {
    frames.restore()
    globalThis.devicePixelRatio = ratio
  }
}

test(
  'an interactive session sizes, settles, follows a drag and a resize, and stops',
  { timeout: 180_000 },
  async () => {
    const errors: string[] = []
    const read = await runOnDawn(startInteractive, null, errors)
    console.log(JSON.stringify(read))
    const { opened, dragged, resized, targets } = read
    assert.deepEqual(errors, [])
    assert.deepEqual(opened.size, [opened.box[0] * 2, opened.box[1] * 2], 'CSS box × pixel ratio')
    assert.equal(opened.controlsReused, true)
    assert.equal(opened.coverageReady, true)
    assert.ok(read.startedStill, 'no scheduled work in a still scene')
    assert.ok(dragged.moved, 'the drag moves the camera')
    assert.ok(dragged.still, 'the session settles after the drag')
    assert.deepEqual(resized.size, opened.box, 'a ratio of one draws the CSS box')
    assert.ok(resized.still, 'the session settles at its new size')
    assert.ok(read.stopped, 'a disposed session schedules nothing')
    assert.deepEqual(read.interactive, [])
    assert.deepEqual(targets.differences, [0, 0], 'an id and an element draw the same image')
    for (const [submitted, selected] of targets.triangles) assert.equal(submitted, selected)
    assert.ok(targets.hasImage)
    assert.deepEqual(targets.overrides, [240, 160])
    assert.equal(targets.disposedOnAbort, true)
    assert.equal(targets.cancelled, 'cancelled')
  },
)
