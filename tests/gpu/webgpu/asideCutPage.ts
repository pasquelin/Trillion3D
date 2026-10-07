// Page side of the aside-cut proof (#1483): the engine's capture of a second camera is cut on the
// GPU, on the main cut's tables, with no other cut to fall back on; the main view, drawn again
// after it, cuts again and holds the image it held before.
import { cameraFace, engine, release, VIEWPORT } from '../kit/sharedSceneProof.ts'
import { difference, redCount, untilHeld } from '../kit/sceneImageProof.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { transformScene } from '../placement/transformScene.ts'

async function sequence(device: GPUDevice, events: unknown[], result: { scene?: unknown }) {
  const scene = transformScene(false)
  const { backend, canvas } = engine(scene, device, (e) => events.push(e))
  try {
    await backend.prepare()
    const before = await untilHeld(backend, cameraFace())
    const [width, height] = VIEWPORT
    // The tile seen from the side: the capture's own cut, its own lists, the main cut's tables.
    const aside = await backend.captureColorView!(cameraFace(0.4), { width, height })
    const after = await untilHeld(backend, cameraFace())
    result.scene = {
      held: before.held !== null && after.held !== null,
      red: redCount(aside),
      bytes: aside.length,
      main: before.held && after.held ? difference(before.held, after.held) : null,
      moved: before.held ? difference(before.held, aside) : null,
    }
  } finally {
    release(backend, canvas, scene)
  }
}

export function runAsideCut() {
  return runOnDevice<{ scene: unknown }>(sequence)
}
