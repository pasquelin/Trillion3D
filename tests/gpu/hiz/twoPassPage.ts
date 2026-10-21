// The cut's two-pass occlusion on the real engine: the camera first sees the far slab beside the
// wall (its clusters drawn into the pyramid the next image reads), then steps in front of the wall,
// where the slab is hidden. The first image there still draws the slab in the main pass — the last
// image's pyramid, projected with the last image's matrix, does not hide it — and its own pyramid
// then does: the next image's main pass holds it for the post pass (`occluded`), the post pass hides
// it again (`postHidden`), and it stays hidden. Temporal antialiasing is on: its jitter must not
// keep the image from being held. Each held image is compared to a fresh engine's.
import type { EngineDiagnostic } from '../../../packages/sdk-browser/src/diagnostic/types.ts'
import type { Engine } from '../../../packages/sdk-browser/src/session/engine/types.ts'
import { cameraFace } from '../../kit/device/sharedSceneProof.ts'
import { untilHeld } from '../../kit/device/sceneImageProof.ts'
import { occluderEngine, onOccluderScene, slabPixels } from './occluderScene.ts'
import { compareImages } from '../../../packages/sdk-core/src/runtime/compareImages.ts'

type Camera = ReturnType<typeof cameraFace>

const options = { temporalAntialiasing: true }

/** Renders `camera` until the engine holds the image (`untilHeld`): the held image, the images it
 *  took (null if it never held), and the most items the main pass held and the post pass hid
 *  meanwhile. */
async function heldPose(backend: Engine, camera: Camera) {
  let occluded = 0,
    postHidden = 0
  const {
    rendered,
    settled: held,
    count,
  } = await untilHeld(backend, camera, ({ metrics }) => {
    occluded = Math.max(occluded, metrics.occluded ?? 0)
    postHidden = Math.max(postHidden, metrics.postHidden ?? 0)
  })
  const pixels = held ?? rendered
  if (!pixels) throw new Error('no image was rendered')
  return { pixels, images: held ? count + 1 : null, occluded, postHidden }
}

/** The same pose on an engine that has never seen another: the witness of the held image. */
async function freshPose(
  device: GPUDevice,
  x: number,
  onDiagnostic: (e: EngineDiagnostic) => void,
) {
  const { backend, release } = occluderEngine(device, onDiagnostic, options)
  try {
    await backend.prepare()
    return (await heldPose(backend, cameraFace(x))).pixels
  } finally {
    release()
  }
}

/** One pose: whether and when it held, what the main pass held and the post pass hid, the slab's
 *  pixels, and the pixels the held image differs from the witness on. */
interface TwoPassStep {
  x: number
  images: number | null
  occluded: number
  postHidden: number
  slab: number
  gap: number
}

export function runTwoPass() {
  return onOccluderScene<TwoPassStep>(options, async (backend, device, onDiagnostic, steps) => {
    // The slab beside the wall, then hidden behind it, then beside it again.
    for (const x of [1.4, 0, 1.4]) {
      const held = await heldPose(backend, cameraFace(x))
      const witness = await freshPose(device, x, onDiagnostic)
      steps.push({
        x,
        images: held.images,
        occluded: held.occluded,
        postHidden: held.postHidden,
        slab: slabPixels(held.pixels),
        gap: compareImages(held.pixels, witness).differentPixels,
      })
    }
  })
}
