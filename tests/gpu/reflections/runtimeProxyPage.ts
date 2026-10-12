// The page of the run-time proxy's proof: a world made at run time — no cooked proxy —, an emissive
// sphere over a thin metal post and a polished floor, seen from above (`runtimeSceneFrame.ts`), drawn
// until it is held and read back from the canvas.
import { runtimeWorld } from './runtimeWorld.ts'
import { proofCanvas } from '../kit/renderHarness.ts'
import { animationFrame } from '../kit/frame.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { readTexture } from '../kit/computeReadback.ts'
import { mirroredSphere } from './runtimeSceneFrame.ts'

/** What the proof reads: the image's size and its RGBA rows, top row first, the pixels of the mask
 *  (`mirroredSphere`) and the frames the world took to hold. */
export type RuntimeReading = {
  width: number
  height: number
  pixels: number[]
  mask: number[]
  frames: number
}

/** The image of the generated world with the run-time proxy `proxied` or without it. */
async function draw() {
  const canvas = proofCanvas('runtime-proxy') as unknown as HTMLCanvasElement & {
    readable: boolean
  }
  canvas.readable = true
  const world = runtimeWorld(canvas)
  await world.ready
  let held = 0,
    frames = 0
  world.onFrame(({ metrics }) => {
    held = metrics.frameHeld ? held + 1 : 0
  })
  for (; frames < 400 && held < 3; frames++) await animationFrame()
  const context = canvas.getContext('webgpu') as unknown as {
    current: GPUTexture | null
    getConfiguration(): { device: GPUDevice }
  }
  const texture = context.current!
  const rows = await readTexture(context.getConfiguration().device, texture, 4)
  const bgra = texture.format.startsWith('bgra')
  const pixels = Array.from(rows, (_, k) => {
    const channel = k & 3
    return rows[bgra && channel < 3 ? (k & ~3) + 2 - channel : k]
  })
  const width = texture.width,
    height = texture.height
  const mask = mirroredSphere(width, height, width / height)
  world.dispose()
  canvas.remove()
  return { width, height, pixels, mask, frames }
}

export const run = () =>
  runOnDevice<RuntimeReading>(async (_device, _events, result) => {
    Object.assign(result, await draw())
  })
