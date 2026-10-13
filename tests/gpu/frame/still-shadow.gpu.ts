// A still view under a shadowed sun draws the same image frame after frame when nothing
// accumulates (`temporalAntialiasing: false`, `facingWorld.ts`): the shadow rays' noise turns with
// the temporal accumulation's phase (`stochasticPhase`), not with the frame counter, so no lit pixel
// changes from one frame to the next — a changing one is a flicker, and no hash of the lit image
// could settle on it.
//
//   node bench/dawn/proofs.ts tests/gpu/frame/still-shadow.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { SUN } from '../../../bench/runner/lighting/lamps.ts'
import { animationFrame, runOnDawn } from '../kit/onDawn.ts'
import { compareImages } from '../../../packages/sdk-core/src/runtime/compareImages.ts'
import { FACING, openFacingWorld } from './facingWorld.ts'

const FRAMES = 24

/** The captured image of each of `FRAMES` frames of the shadowed sun on a still view. */
async function frames() {
  const world = await openFacingWorld('three-stack')
  try {
    world.addLight(SUN)
    const images: Uint8Array[] = []
    for (let i = 0; i < FRAMES; i++) {
      await animationFrame()
      world.render(FACING)
      await world.flush()
      images.push(new Uint8Array(await world.capture()))
    }
    return images
  } finally {
    world.dispose()
  }
}

test('a still view under a shadowed sun draws one image, frame after frame', async () => {
  const errors: string[] = []
  const images = await runOnDawn(frames, null, errors)
  assert.deepEqual(errors, [])
  const changes = images.slice(1).map((image, i) => compareImages(image, images[i]).differentPixels)
  console.log(JSON.stringify({ changes }))
  assert.deepEqual(changes, Array(FRAMES - 1).fill(0))
})
