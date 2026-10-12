// The engine side of the temporal antialiasing proof: the real WebGPU engine on two opaque tiles —
// a full-frame blue background and a rotated red tile, whose edges are oblique — rendered with and
// without temporal accumulation: still, under a camera pan, then after a move of the tile. Nothing
// internal is read: `setTransform` on one side, read-back pixels and `frameHeld` on the other.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import type { EngineDiagnostic } from '../../../packages/sdk-browser/src/engine/types.ts'
import {
  VIEWPORT,
  batisseur as sceneBuilder,
  cameraFace as facingCamera,
  release as release,
  engine,
  versApi as toApiMatrix,
} from '../kit/sharedSceneProof.ts'
import { image, untilHeld } from '../kit/sceneImageProof.ts'
import { runAccumulation as withAndWithoutAccumulation } from '../kit/deviceProof.ts'

/** The tile's rotation, a third of a radian: its edges are oblique. */
const TURN = 0.33

/** The background and the red tile. */
function scene() {
  const builder = sceneBuilder()
  const backdrop = G.basicSurface({ color: 0x1b3a5c })
  builder.place(backdrop, 'exact-clusters', 4, [0, 0, -2]).name = 'background'
  const red = G.basicSurface({ color: 0xff2020 })
  builder.place(red, 'exact-clusters', 0.6, [0, 0, 0], { z: TURN }).name = 'tile'
  return builder.fini()
}

/** `camera` slid to `x` without changing its optical axis, as `cameraFace` places it. */
function slide(camera: ReturnType<typeof facingCamera>, x: number) {
  camera.position.set(x, 0, 3)
  camera.lookAt(x, 0, 0)
  camera.updateMatrixWorld(true)
}

/** One run: still, panned, then the tile moved. `temporal` picks the option. */
async function fullRun(device: GPUDevice, events: unknown[], temporal: boolean) {
  const prepared = scene(),
    own: EngineDiagnostic[] = []
  const { backend, canvas } = engine(
    prepared,
    device,
    (event) => {
      own.push(event)
      events.push(event)
    },
    { temporalAntialiasing: temporal },
  )
  const camera = facingCamera()
  try {
    await backend.prepare()
    const still = await untilHeld(backend, camera)
    // The pan: the camera slides about two thirds of a pixel per frame, for sixteen frames. It is
    // one camera moved, as a host's controls move theirs: a new camera object at another pose is a
    // view cut, which drops the history (`trackViewCamera`). Nothing is held; the last rendered
    // image is the one read.
    let pannedPixels: Uint8Array = new Uint8Array()
    for (let i = 1; i <= 16; i++) {
      slide(camera, 0.02 * i)
      pannedPixels = (await image(backend, camera)).pixels
    }
    const panned = Array.from(pannedPixels)
    slide(camera, 0)
    if (!backend.setTransform) throw new Error('the backend has no setTransform')
    backend.setTransform(
      'tile',
      toApiMatrix(new G.Matrix4().makeRotationZ(TURN).setPosition(0.5, 0, 0)),
    )
    const moved = await untilHeld(backend, camera)
    const capabilities = own.find((e) => e.phase === 'render-capabilities')?.context ?? null
    return { still, panned, moved, capabilities }
  } finally {
    release(backend, canvas, prepared)
  }
}

/** Without accumulation, with it, and with it again as the A/A witness; and the viewport. */
export async function run() {
  return { viewport: VIEWPORT, ...(await withAndWithoutAccumulation(fullRun)) }
}
