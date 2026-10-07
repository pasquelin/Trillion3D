// The same physical camera (near 2.8, far 12) and a tilted transparent tile that crosses the near
// plane, while only the clip convention a host declares changes: none, then WebGPU's `[0, 1]`
// (`coordinateSystem`, as the witness library's camera carries it), then none again. The engine
// never reads it: it composes its own projection, in reversed depth and with an infinite far plane
// (`readCameraWorld`, `depthConvention.ts`). The image must stay identical pixel for pixel, and the
// held image stay held: nothing is left to recompute when the host declares its convention.
import { WebGPUCoordinateSystem } from 'three'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { cameraFace, release, engine } from '../kit/sharedSceneProof.ts'
import { difference, image, redCount } from '../kit/sceneImageProof.ts'
import { runPasses } from '../kit/deviceProof.ts'
import { TILE, transformScene } from '../placement/transformScene.ts'

/** Frames rendered under each convention: enough for the image to be held. */
const FRAMES = 6

/**
 * One pass, `paged` or not: the tilted tile with no declared convention until held, then under the
 * WebGPU convention, then with the declaration removed. The physical view — position, look, near,
 * far, field — never moves.
 */
async function sequence(device: GPUDevice, paged: boolean, events: unknown[]) {
  const scene = transformScene(paged)
  const { backend, canvas } = engine(scene, device, (e) => events.push({ paged, ...e }))
  const camera = cameraFace()
  camera.near = 2.8
  camera.far = 12
  camera.updateProjectionMatrix()
  const frames: { name: string; held: boolean | null | undefined }[] = []
  /** `FRAMES` frames under `convention` (none declared when absent), named by `phase`: the last
   *  one's pixels. */
  const under = async (phase: string, convention?: number) => {
    const declared = camera as unknown as { coordinateSystem?: number }
    if (convention === undefined) delete declared.coordinateSystem
    else declared.coordinateSystem = convention
    camera.updateProjectionMatrix()
    let pixels: Uint8Array | undefined
    for (let i = 0; i < FRAMES; i++) {
      const frame = await image(backend, camera)
      frames.push({ name: `${phase}-${i}`, held: frame.metrics.frameHeld })
      pixels = frame.pixels
    }
    if (!pixels) throw new Error('no frame was rendered')
    return pixels
  }
  try {
    await backend.prepare()
    // Tilted about y, the tile's corners leave the z = 0 plane: at near 2.8, one passes in front
    // of the camera's near plane rather than behind it.
    if (!backend.setTransform) throw new Error('the backend has no setTransform')
    backend.setTransform(TILE, new Float32Array(new G.Matrix4().makeRotationY(0.9).elements))
    const own = await under('own')
    const webgpu = await under('webgpu', WebGPUCoordinateSystem)
    const back = await under('back')
    return {
      frames,
      red: redCount(own),
      toWebgpu: difference(own, webgpu),
      back: difference(own, back),
    }
  } finally {
    release(backend, canvas, scene)
  }
}

export function runConventionFlip() {
  return runPasses(sequence)
}
