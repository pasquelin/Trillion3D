// The visibility raster and the material surfaces as render bundles, on the real engine: the
// occluding scene of the Hi-Z proofs under the two-pass occlusion and temporal antialiasing, the
// camera beside the wall, hidden behind it, then beside it again — both halves of the raster, the
// tested half compacted or not. Each pose is rendered until held with the bundles, and on a second
// engine, walking the same poses, whose bundles are encoded as their commands in the pass
// (`withDirectBundles`): the witness. The bundles each image records are counted.
import type { EngineDiagnostic, Engine } from '../../../packages/sdk-browser/src/engine/types.ts'
import { cameraFace } from '../kit/sharedSceneProof.ts'
import { difference, untilHeld } from '../kit/sceneImageProof.ts'
import { countBundles, withDirectBundles } from '../kit/directBundles.ts'
import { occluderEngine, onOccluderScene } from '../hiz/occluderScene.ts'

const options = { stageProfile: true, temporalAntialiasing: true }

type Counts = ReturnType<typeof countBundles>['counts']

/** Renders `x` until held (`untilHeld`): the held pixels (null if never), and the bundles each
 *  image recorded when `counts` counts them. */
async function heldPose(backend: Engine, x: number, counts?: Counts) {
  const recorded: number[] = []
  let before = counts?.recorded ?? 0
  const { held } = await untilHeld(backend, cameraFace(x), () => {
    const now = counts?.recorded ?? 0
    recorded.push(now - before)
    before = now
  })
  return { pixels: held, recorded }
}

/** The witness: one engine whose bundles are encoded as their commands, built at its first pose
 *  and moved from pose to pose. It runs only within `withDirectBundles` — the bundles it
 *  keeps are recorded commands, never real bundles. */
function directWitness(device: GPUDevice, onDiagnostic: (e: EngineDiagnostic) => void) {
  let direct: ReturnType<typeof occluderEngine> | undefined
  return {
    pose: (x: number) =>
      withDirectBundles(async () => {
        if (!direct) {
          direct = occluderEngine(device, onDiagnostic, options)
          await direct.backend.prepare()
        }
        return (await heldPose(direct.backend, x)).pixels
      }),
    release: () => withDirectBundles(() => direct?.release()),
  }
}

/** One pose: the bundles executed and recorded by its images, those its images after the first
 *  recorded, and the pixels the held image differs from the direct witness on (null: not held). */
interface BundleStep {
  x: number
  /** The labels of every bundle recorded so far. */
  labels: string[]
  executed: number
  recorded: number
  recordedAfterFirst: number
  gap: number | null
}

export function runRenderBundles() {
  return onOccluderScene<BundleStep>(options, async (backend, device, onDiagnostic, steps) => {
    const counting = countBundles()
    const direct = directWitness(device, onDiagnostic)
    try {
      for (const x of [1.4, 0, 1.4]) {
        const executed = counting.counts.executed
        const held = await heldPose(backend, x, counting.counts)
        const witness = await direct.pose(x)
        steps.push({
          x,
          labels: [...counting.counts.labels].sort(),
          executed: counting.counts.executed - executed,
          recorded: held.recorded.reduce((sum, n) => sum + n, 0),
          recordedAfterFirst: held.recorded.slice(1).reduce((sum, n) => sum + n, 0),
          gap: held.pixels && witness ? difference(held.pixels, witness) : null,
        })
      }
    } finally {
      await direct.release()
      counting.restore()
    }
  })
}
