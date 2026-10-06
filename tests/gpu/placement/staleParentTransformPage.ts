// Page of the stale-parent proof: the real WebGPU engine, a real device, a real reread image. The
// host writes the parent's position, rotation and scale directly — never through `setTransform`,
// never followed by a manual `updateMatrixWorld` — so the only way the engine can see that change
// is the resolution it does itself before inverting the parent's matrix (`poseNode`, in
// `setWebgpuTransform`).
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { release } from '../kit/sharedSceneProof.ts'
import { difference, image, redCount } from '../kit/sceneImageProof.ts'
import { runPasses } from '../kit/deviceProof.ts'
import { PIVOT, TILE, openPass, translation } from './transformScene.ts'

/**
 * One pass: pose, dirty the parent without notifying, ask the same world pose again, settle,
 * dirty again and ask again, ask another pose, then make the parent singular and read the named
 * refusal.
 */
async function sequence(device: GPUDevice, paged: boolean, events: unknown[]) {
  const { s, backend, canvas, setTransform, camera } = openPass(device, paged, events)
  const pivot = G.byName(s.source, PIVOT)
  if (!pivot) throw new Error('scene missing pivot node')
  const steps: { name: string; held: boolean | null | undefined; red: number }[] = []
  const step = async (name: string) => {
    const { pixels, metrics } = await image(backend, camera)
    steps.push({ name, held: metrics.frameHeld, red: redCount(pixels) })
    return pixels
  }
  try {
    await backend.prepare()
    setTransform(TILE, translation(-0.8))
    let reference: Uint8Array | undefined
    for (let i = 0; i < 6; i++) reference = await step(`initial-${i}`)
    // The host writes the parent WITHOUT going through `setTransform` or calling
    // `updateMatrixWorld`: its world matrix stays stale until something walks it up.
    pivot.position.set(10, 3, -2)
    pivot.rotation.set(0.2, -0.3, 0.4)
    pivot.scale.set(2, 0.7, 1.5)
    setTransform(TILE, translation(-0.8))
    const dirty = await step('parent-dirty')
    let settled: Uint8Array | undefined
    for (let i = 0; i < 6; i++) settled = await step(`settled-${i}`)
    pivot.position.x = -12
    setTransform(TILE, translation(-0.8))
    const repeated = await step('repeat-after-parent')
    setTransform(TILE, translation(0.8))
    const moved = await step('moved')
    pivot.scale.y = 0
    let singular: string | null = null
    try {
      setTransform(TILE, translation(0))
    } catch (error) {
      singular = (error as { code?: string }).code ?? String(error)
    }
    if (!reference || !settled) throw new Error('sequence produced no frame')
    return {
      steps,
      initialRed: redCount(reference),
      dirtyPixels: difference(reference, dirty),
      settledPixels: difference(reference, settled),
      repeatPixels: difference(reference, repeated),
      movedPixels: difference(reference, moved),
      singular,
    }
  } finally {
    release(backend, canvas, s)
  }
}

/** The sequence, unpaged then paged. */
export const run = () => runPasses(sequence)
