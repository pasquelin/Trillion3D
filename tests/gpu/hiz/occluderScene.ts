// The occluding scene the Hi-Z proofs share: a near opaque wall and a far opaque slab, offset, so
// that view parallax takes the slab out from behind the wall and its clusters' occlusion verdict
// flips with the camera.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import type {
  EngineContext,
  EngineDiagnostic,
  Engine,
} from '../../../packages/sdk-browser/src/engine/types.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { batisseur, square, engine, release, type ScenePreparee } from '../kit/sharedSceneProof.ts'

function occluderScene(): ScenePreparee {
  const builder = batisseur()
  const wall = G.mesh(square(0.8), G.basicSurface({ color: 0xdedede, side: G.DOUBLE_SIDE }))
  wall.name = 'wall'
  wall.position.set(0, 0, 1)
  builder.source.add(wall)
  builder.add(wall, 'exact-clusters', 0.8)
  const slab = G.mesh(square(0.25), G.basicSurface({ color: 0x20c040, side: G.DOUBLE_SIDE }))
  slab.name = 'slab'
  slab.position.set(0.9, 0, -3)
  builder.source.add(slab)
  builder.add(slab, 'exact-clusters', 0.25)
  return builder.fini()
}

/** How many pixels carry the far slab's green: what occlusion takes from it. */
export function slabPixels(pixels: Uint8Array | number[]): number {
  let n = 0
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i + 1] > 110 && pixels[i + 1] > pixels[i] + 40 && pixels[i + 1] > pixels[i + 2] + 40)
      n++
  return n
}

/** An engine of `options` mounted on a fresh occluding scene: the witness of a pose. */
export function occluderEngine(
  device: GPUDevice,
  onDiagnostic: (e: EngineDiagnostic) => void,
  options: Partial<EngineContext> = {},
) {
  const scene = occluderScene()
  const { backend, canvas } = engine(scene, device, onDiagnostic, options)
  return { backend, release: () => release(backend, canvas, scene) }
}

/**
 * Runs `body(backend, device, onDiagnostic, steps)` on the real engine mounted on this scene, with
 * `options` completing the host context, and answers in the shape the kit's page proofs read
 * (`enginePageProof.ts`): the steps the body filled, the engine's diagnostics, the device's
 * errors, or the error that stopped it.
 */
export async function onOccluderScene<Step>(
  options: Partial<EngineContext>,
  body: (
    backend: Engine,
    device: GPUDevice,
    onDiagnostic: (e: EngineDiagnostic) => void,
    steps: Step[],
  ) => Promise<void>,
) {
  const gpu = await openGpuDevice()
  if (!gpu) return { unavailable: 'no WebGPU adapter', steps: [] as Step[] }
  const events: EngineDiagnostic[] = []
  const onDiagnostic = (e: EngineDiagnostic) => void events.push(e)
  const { backend, release } = occluderEngine(gpu.device, onDiagnostic, options)
  const steps: Step[] = []
  try {
    await backend.prepare()
    await body(backend, gpu.device, onDiagnostic, steps)
  } catch (error) {
    const trace = error instanceof Error ? (error.stack ?? '') : ''
    return { error: String(error) + trace, steps, events, errors: gpu.errors }
  } finally {
    release()
  }
  const { court: adapter } = await gpu.fermer()
  return { adapter, steps, events, errors: gpu.errors }
}
