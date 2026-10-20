// The page of the run-time proxy's family proof: the world of one case (`runtimeFamilyWorld.ts`) drawn until
// it is held — a moving case moved and held again —, the reflection target the engine wrote read back at a
// grid of its pixels, and the frames timed.
import { proofCanvas } from '../../kit/device/renderHarness.ts'
import { animationFrame } from '../../kit/device/frame.ts'
import { lastFrameOf } from '../../../packages/sdk-browser/src/world/core/worldSession.ts'
import { runOnDevice } from '../../kit/device/deviceProof.ts'
import { readTexture } from '../../kit/device/computeReadback.ts'
import { latestMade, listenToWorldDevices } from '../../kit/device/worldErrors.ts'
import { familyCase, gridPixels } from './runtimeFamilyCases.ts'
import { texelBytesOf } from '../../../packages/sdk-browser/src/gpu/core/textureBytes.ts'
import { familyWorld } from './runtimeFamilyWorld.ts'
import { rgbAt } from './rigFrame.ts'

type FamilyReading = {
  width: number
  height: number
  /** The reflection target's RGB at each grid pixel, row by row, `GRID` pixels apart from the middle of a cell. */
  samples: number[]
  frames: number
  worldErrors: string[]
}

type Canvas = HTMLCanvasElement & { readable: boolean }

/** Frames drawn until the world holds three in a row, at most `limit`: each asked by the page
 *  (`world.render`) and read on the frame the session last made (`lastFrameOf`), held or drawn — a
 *  held frame asks its loop for none, and the hooks of `onFrame` run on drawn frames alone. */
async function hold(world: ReturnType<typeof familyWorld>['world'], limit = 400) {
  let held = 0,
    frames = 0
  for (; frames < limit && held < 3; frames++) {
    await animationFrame()
    world.render()
    held = lastFrameOf(world)?.frameHeld ? held + 1 : 0
  }
  return frames
}

async function draw(index: number, limit: number) {
  const c = familyCase(index)
  const { errors: worldErrors, textures } = listenToWorldDevices()
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
  const target = latestMade(textures, (label) => /^Trillion3D reflection( @t3d:\d+)?$/.test(label))
  if (!target) throw new Error(`no reflection target among ${[...textures.keys()].join(' | ')}`)
  const { width, height } = target
  const raw = await readTexture(canvasDevice(canvas), target, texelBytesOf(target.format))
  const half = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2)
  const samples = gridPixels(width, height).flatMap(([i, j]) => rgbAt(half, j * width + i))
  world.dispose()
  canvas.remove()
  return {
    width,
    height,
    samples,
    frames,
    worldErrors,
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
