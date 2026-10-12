// The page of the run-time proxy's proof: a world made at run time — no cooked proxy —, an emissive
// sphere over a thin metal post and a polished floor, seen from above (`runtimeSceneFrame.ts`), drawn
// until it is held and read back from the canvas.
import { runtimeWorld } from './runtimeWorld.ts'
import { listenToWorldDevices, readWords } from '../kit/worldErrors.ts'
import { HISTORY } from '../../../packages/sdk-browser/src/reflections/proxyHistory.ts'
import { proofCanvas } from '../kit/renderHarness.ts'
import { animationFrame } from '../kit/frame.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { readTexture } from '../kit/computeReadback.ts'
import { mirroredSphere, type Kind } from './runtimeSceneFrame.ts'

/** What the proof reads: the image's size and its RGBA rows, top row first, the pixels of the mask
 *  (`mirroredSphere`) and the frames the world took to hold. */
export type RuntimeReading = {
  width: number
  height: number
  pixels: number[]
  mask: number[]
  frames: number
  /** The errors the world's own device raised. */
  worldErrors: string[]
  /** After the image: the milliseconds a frame takes over sixty redrawn, the run-time proxy's work the last
   *  spent and the pixels it left for a later image (`HISTORY`); none without a history. */
  frameMs: number
  /** The engine's own GPU timer over those frames: the whole frame, and the reflections' passes. */
  gpuFrameMs: number
  gpuTraceMs: number
  spent: number
  left: number
}

/** What a canvas's WebGPU context holds in the proof's fake display: the texture of the last image, the
 *  device the world draws on. */
export type CanvasContext = {
  current: GPUTexture | null
  getConfiguration(): { device: GPUDevice }
}
export const canvasContext = (canvas: HTMLCanvasElement) =>
  canvas.getContext('webgpu') as unknown as CanvasContext

/** The image the canvas holds as RGBA rows, top first, and the pixels of the mask of `kind`. */
export async function readImage(context: CanvasContext, kind: Kind) {
  const texture = context.current!
  const rows = await readTexture(context.getConfiguration().device, texture, 4)
  const bgra = texture.format.startsWith('bgra')
  const pixels = Array.from(rows, (_, k) => {
    const channel = k & 3
    return rows[bgra && channel < 3 ? (k & ~3) + 2 - channel : k]
  })
  const { width, height } = texture
  return { pixels, width, height, mask: mirroredSphere(kind, width, height, width / height) }
}

/** The image of the generated world of `kind`, drawn until it is held, and the frames timed after it. */
async function draw(kind: Kind) {
  const { errors: worldErrors, made } = listenToWorldDevices()
  const canvas = proofCanvas(`runtime-proxy-${kind}`) as unknown as HTMLCanvasElement & {
    readable: boolean
  }
  canvas.readable = true
  const world = runtimeWorld(canvas, kind)
  await world.ready
  let held = 0,
    frames = 0
  world.onFrame(({ metrics }) => {
    held = metrics.frameHeld ? held + 1 : 0
  })
  for (; frames < 400 && held < 3; frames++) await animationFrame()
  const context = canvasContext(canvas)
  const { pixels, width, height, mask } = await readImage(context, kind)
  // Sixty frames redrawn — the eye moves a hair each — and timed to the GPU's end.
  const device = context.getConfiguration().device
  const eye = world.camera.position.x
  const timed: { frame: number; trace: number }[] = []
  world.onFrame(({ metrics }) => {
    const passes = (metrics.gpuPassMs as { passes?: { name: string; ownMs?: number }[] } | null)
      ?.passes
    const trace = (passes ?? [])
      .filter((pass) => pass.name === 'Trillion3D reflections')
      .reduce((sum, pass) => sum + (pass.ownMs ?? 0), 0)
    if (typeof metrics.gpuFrameMs === 'number') timed.push({ frame: metrics.gpuFrameMs, trace })
  })
  const started = performance.now()
  for (let k = 0; k < 60; k++) {
    world.camera.position.x = eye + (k % 2) * 1e-3
    await animationFrame()
    await device.queue.onSubmittedWorkDone()
  }
  const frameMs = (performance.now() - started) / 60
  const mean = (pick: (t: (typeof timed)[number]) => number) =>
    timed.length ? timed.reduce((sum, t) => sum + pick(t), 0) / timed.length : 0
  const history = [...made]
    .reverse()
    .find(([label]) => label.startsWith('Trillion3D run-time proxy history'))?.[1]
  const counters = history ? await readWords(device, history, 4) : [0, 0, 0, 0]
  world.dispose()
  canvas.remove()
  return {
    width,
    height,
    pixels,
    mask,
    frames,
    worldErrors,
    frameMs,
    gpuFrameMs: mean((t) => t.frame),
    gpuTraceMs: mean((t) => t.trace),
    spent: counters[HISTORY.spent],
    left: counters[HISTORY.left],
  }
}

export const run = (kind: Kind) =>
  runOnDevice<RuntimeReading>(async (_device, _events, result) => {
    Object.assign(result, await draw(kind))
  })
