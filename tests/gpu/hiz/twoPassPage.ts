// The two-phase Hi-Z on the real engine: the camera first sees the far slab beside the wall (its
// clusters drawn, hence occluders of the next image), then steps in front of the wall, where the
// slab is hidden. The first image there still draws the slab's rows in the main pass — the last
// image's pyramid, read with the last image's rectangles, does not hide them — and its own pyramid
// then does: the next image withdraws them (`pyramidWithdrawn`), the post pass rejects them, and
// they stay rejected. Temporal antialiasing is on: its jitter once made rows trade halves every
// image, and the image must still be held. Each held image is compared to a fresh engine's.
import type { EngineDiagnostic, Engine } from '../../../packages/sdk-browser/src/engine/types.ts'
import { cameraFace, countsStep } from '../kit/sharedSceneProof.ts'
import { difference, untilHeld } from '../kit/sceneImageProof.ts'
import { occluderEngine, onOccluderScene, slabPixels } from './occluderScene.ts'

type Camera = ReturnType<typeof cameraFace>

const options = { stageProfile: true, temporalAntialiasing: true }

/** Renders `camera` until the engine holds the image (`untilHeld`): the held image, the images it
 *  took (null if it never held), and the largest withdrawal and rejection sampled meanwhile. */
async function heldPose(backend: Engine, camera: Camera) {
  let withdrawn = 0,
    rejected = 0
  const { rendered, held, count } = await untilHeld(backend, camera, ({ metrics }) => {
    withdrawn = Math.max(withdrawn, countsStep(backend, 'partition')?.pyramidWithdrawn ?? 0)
    rejected = Math.max(rejected, metrics.hizRejectedClusters ?? 0)
  })
  const pixels = held ?? rendered
  if (!pixels) throw new Error('no image was rendered')
  return { pixels, images: held ? count + 1 : null, withdrawn, rejected }
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

/** One pose: whether and when it held, what the partition withdrew and the test rejected, the
 *  slab's pixels, and the pixels the held image differs from the witness on. */
interface TwoPassStep {
  x: number
  images: number | null
  withdrawn: number
  rejected: number
  slab: number
  gap: number
  rows: number | null
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
        withdrawn: held.withdrawn,
        rejected: held.rejected,
        slab: slabPixels(held.pixels),
        gap: difference(held.pixels, witness),
        rows: countsStep(backend, 'partition')?.rows ?? null,
      })
    }
  })
}
