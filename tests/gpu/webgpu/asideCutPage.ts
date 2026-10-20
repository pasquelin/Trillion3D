// Page side of the aside-cut proof (#1483): the engine's capture of a second camera is cut on the
// GPU, on the main cut's tables, with no other cut to fall back on; the main view, drawn again
// after it, cuts again and holds the image it held before.
import { cameraFace, engine, release, VIEWPORT } from '../../kit/device/sharedSceneProof.ts'
import { redCount, untilHeld } from '../../kit/device/sceneImageProof.ts'
import { compareImages } from '../../../packages/sdk-core/src/runtime/compareImages.ts'
import { runOnDevice } from '../../kit/device/deviceProof.ts'
import { transformScene } from '../placement/transformScene.ts'

async function sequence(device: GPUDevice, events: unknown[], result: { scene?: unknown }) {
  const scene = transformScene()
  const { backend, canvas } = engine(scene, device, (e) => events.push(e))
  try {
    await backend.prepare()
    const before = await untilHeld(backend, cameraFace())
    const [width, height] = VIEWPORT
    // The tile seen from the side: the capture's own cut, its own lists, the main cut's tables.
    const aside = await backend.captureColorView!(cameraFace(0.4), { width, height })
    const after = await untilHeld(backend, cameraFace())
    result.scene = {
      held: before.settled !== null && after.settled !== null,
      red: redCount(aside),
      bytes: aside.length,
      main:
        before.settled && after.settled
          ? compareImages(before.settled, after.settled).differentPixels
          : null,
      moved: before.settled ? compareImages(before.settled, aside).differentPixels : null,
    }
  } finally {
    release(backend, canvas, scene)
  }
}

export function runAsideCut() {
  return runOnDevice<{ scene: unknown }>(sequence)
}
