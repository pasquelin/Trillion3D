// What the frame and coplanar proofs share: a coplanar golden of the formats corpus compiled by
// this checkout's native compiler (`coplanarCache`), drawn by the WebGPU page raster in a canvas
// whose image can be read back, from an eye facing the plane its surfaces lie in.
import type { FakeCanvas } from '../../../bench/dawn/canvas.ts'
import { measureOutput } from '../../../bench/core/paths.ts'
import type { CameraPose } from '../../../packages/sdk-core/src/index.ts'
import { coplanarCache, openEngineWorld, proofCanvas } from '../kit/renderHarness.ts'

/** The image's size: small, every surface still many pixels wide. */
export const VIEW: [number, number] = [192, 144]

/** The eye: nine units in front of the point (3, 3, 0) of the plane `z = 0`, looking at it. The
 *  goldens lie in `[0, 6]²` of that plane, their faces towards `+z`. */
export const FACING: CameraPose = {
  position: [3, 3, 9],
  target: [3, 3, 0],
  fov: 50,
  near: 0.1,
  far: 100,
}

/** The first byte of the pixel where the point `(x, y, 0)` of the plane lands in an image of
 *  `VIEW`, bottom row first as `capture()` returns it. */
export function pixelOf(x: number, y: number) {
  const [width, height] = VIEW
  const half = (FACING.position[2] - FACING.target[2]) * Math.tan((FACING.fov * Math.PI) / 360)
  const ndcX = (x - FACING.target[0]) / (half * (width / height)),
    ndcY = (y - FACING.target[1]) / half
  const column = Math.floor(((ndcX + 1) / 2) * width),
    row = Math.floor(((ndcY + 1) / 2) * height)
  return (row * width + column) * 4
}

/** The pixels of `image` at the points of the square `[x0, x1] × [y0, y1]` of the plane, a step of
 *  `step` apart: RGB each. */
export function region(image: Uint8Array, [x0, x1]: number[], [y0, y1]: number[], step = 0.25) {
  const read: number[][] = []
  for (let y = y0; y <= y1 + 1e-9; y += step)
    for (let x = x0; x <= x1 + 1e-9; x += step) {
      const at = pixelOf(x, y)
      read.push([image[at], image[at + 1], image[at + 2]])
    }
  return read
}

/** The golden `name` compiled, opened on the WebGPU page raster in a readable canvas of `VIEW`
 *  pixels, no temporal accumulation, the exact leaves drawn, and posed at `FACING`. */
export async function openFacingWorld(name: string) {
  const { manifestUrl } = coplanarCache(measureOutput('gpu-proofs', `facing-${name}`), name)
  const canvas = proofCanvas(`facing-${name}`) as unknown as FakeCanvas
  // Before the engine configures it: a texture read back carries COPY_SRC from the start.
  canvas.readable = true
  const world = await openEngineWorld(canvas as unknown as HTMLCanvasElement, {
    manifestUrl,
    scope: 'full',
    interactive: false,
    width: VIEW[0],
    height: VIEW[1],
    pixelRatio: 1,
    pixelError: 0,
    temporalAntialiasing: false,
  })
  world.setPose(FACING)
  return world
}
