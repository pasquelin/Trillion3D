// The page of the run-time proxy's family proof: the world of one case (`runtimeFamilyWorld.ts`) drawn until
// it is held — a moving case moved and held again —, the reflection target the engine wrote read back at a
// grid of its pixels, and the frames timed.
import { fromHalf } from '../../../packages/math/src/float/half.ts'
import { HISTORY } from '../../../packages/sdk-browser/src/reflections/proxyHistory.ts'
import { proofCanvas } from '../kit/renderHarness.ts'
import { animationFrame } from '../kit/frame.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { readTexture } from '../kit/computeReadback.ts'
import { listenToWorldDevices, readWords } from '../kit/worldErrors.ts'
import { familyCase, GRID } from './runtimeFamilyCases.ts'
import { familyWorld } from './runtimeFamilyWorld.ts'

export type FamilyReading = {
  width: number
  height: number
  /** The reflection target's RGB at each grid pixel, row by row, `GRID` pixels apart from the middle of a cell. */
  samples: number[]
  frames: number
  worldErrors: string[]
  spent: number
  left: number
}

type Canvas = HTMLCanvasElement & { readable: boolean }

/** Frames drawn until the world holds three in a row, at most `limit`. */
export async function hold(world: ReturnType<typeof familyWorld>['world'], limit = 400) {
  let held = 0,
    frames = 0
  world.onFrame(({ metrics }) => {
    held = metrics.frameHeld ? held + 1 : 0
  })
  for (; frames < limit && held < 3; frames++) await animationFrame()
  return frames
}

async function draw(index: number, limit: number) {
  const c = familyCase(index)
  const { errors: worldErrors, made, textures } = listenToWorldDevices()
  const canvas = proofCanvas(`runtime-family-${index}`) as unknown as Canvas
  canvas.readable = true
  const { world, moved } = familyWorld(canvas, c)
  await world.ready
  let frames = await hold(world, limit)
  if (c.shapes.some((s) => s.move.some((v) => v !== 0))) {
    moved()
    await animationFrame()
    await animationFrame()
    frames += await hold(world, limit)
  }
  const target = [...textures]
    .reverse()
    .find(([label]) => /^Trillion3D reflection( @t3d:\d+)?$/.test(label))?.[1]
  if (!target) throw new Error(`no reflection target among ${[...textures.keys()].join(' | ')}`)
  const { width, height } = target
  const raw = await readTexture(canvasDevice(canvas), target, 8)
  const half = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2)
  const samples: number[] = []
  for (let j = GRID >> 1; j < height; j += GRID)
    for (let i = GRID >> 1; i < width; i += GRID) {
      const at = (j * width + i) * 4
      samples.push(fromHalf(half[at]), fromHalf(half[at + 1]), fromHalf(half[at + 2]))
    }
  const history = [...made]
    .reverse()
    .find(([label]) => label.startsWith('Trillion3D run-time proxy history'))?.[1]
  const counters = history ? await readWords(canvasDevice(canvas), history, 4) : [0, 0, 0, 0]
  world.dispose()
  canvas.remove()
  return {
    width,
    height,
    samples,
    frames,
    worldErrors,
    spent: counters[HISTORY.spent],
    left: counters[HISTORY.left],
  }
}

const canvasDevice = (canvas: Canvas) =>
  (
    canvas.getContext('webgpu') as unknown as { getConfiguration(): { device: GPUDevice } }
  ).getConfiguration().device

export const run = ({ index, limit }: { index: number; limit: number }) =>
  runOnDevice<FamilyReading>(async (_device, _events, result) => {
    Object.assign(result, await draw(index, limit))
  })
