// The page of the run-time proxy's proof: a world made at run time — no cooked proxy —, an emissive
// sphere over a thin metal post and a polished floor, seen from above (`runtimeSceneFrame.ts`), drawn
// until it is held and read back from the canvas.
import {
  createWorld,
  geometry,
  light,
  material,
  math,
  object,
} from '../../../packages/sdk-browser/src/index.ts'
import { proofCanvas } from '../kit/renderHarness.ts'
import { animationFrame } from '../kit/frame.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { readTexture } from '../kit/computeReadback.ts'
import { EYE, FOV, POST, SPHERE, TARGET, mirroredSphere } from './runtimeSceneFrame.ts'

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
  const world = createWorld(canvas)
  world.scene.background = math.color('#05070d')
  const floor = object.mesh(
    geometry.box(60, 0.2, 60),
    material.meshStandard({ color: '#ffffff', metalness: 1, roughness: 0.02 }),
  )
  floor.position.y = -0.1
  const post = object.mesh(
    geometry.cylinder(POST.radius, POST.radius, POST.height, 16),
    material.meshStandard({ color: '#2b2f36', metalness: 0.8, roughness: 0.4 }),
  )
  post.position.set(0, POST.height / 2, 0)
  const globe = object.mesh(
    geometry.sphere(SPHERE.radius, 32, 16),
    material.meshStandard({ color: '#000000', emissive: '#ffcf8a', emissiveIntensity: 12 }),
  )
  globe.position.set(...SPHERE.centre)
  world.scene.add(
    floor,
    post,
    globe,
    light.point({ position: [...SPHERE.centre], color: '#ffcf8a', intensity: 18, distance: 10 }),
    light.hemisphere({ color: '#3a4c80', groundColor: '#0b0d12', intensity: 0.2 }),
  )
  world.camera.set({ position: [...EYE], target: [...TARGET], fov: FOV })
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
