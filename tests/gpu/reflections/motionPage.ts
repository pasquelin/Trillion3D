// The page of the run-time proxy's motion proof: a case over a mirror floor (`motionPath.ts`) drawn at a
// size whose rays outnumber the frame's budget until it holds, then moved along its path one pose an image,
// the reflection target the engine wrote read at the family's grid after each image, with the trace's
// counters.
import { fromHalf } from '../../../packages/math/src/float/half.ts'
import { proofCanvas } from '../kit/renderHarness.ts'
import { animationFrame } from '../kit/frame.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { readTexture } from '../kit/computeReadback.ts'
import { latestMade, listenToWorldDevices } from '../kit/worldErrors.ts'
import { GRID } from './runtimeFamilyCases.ts'
import { familyWorld, traceCounters } from './runtimeFamilyWorld.ts'
import { hold } from './runtimeFamilyPage.ts'
import { motionCase, motionPoses } from './motionPath.ts'

/** What the proof reads: the image's size, then for each pose the target's RGB at the grid (row by row)
 *  and the pixels the trace left for a later image. */
export type MotionReading = {
  width: number
  height: number
  images: { samples: number[]; left: number }[]
  worldErrors: string[]
}

type Canvas = HTMLCanvasElement & { readable: boolean; css: { width: number; height: number } }

export const run = ({ index, size }: { index: number; size: readonly [number, number] }) =>
  runOnDevice<MotionReading>(async (_device, _events, result) => {
    const { errors, made, textures } = listenToWorldDevices()
    const canvas = proofCanvas(`runtime-motion-${index}`) as unknown as Canvas
    canvas.readable = true
    Object.assign(canvas.css, { width: size[0], height: size[1] })
    canvas.width = size[0]
    canvas.height = size[1]
    const c = motionCase(index)
    const { world } = familyWorld(canvas, c)
    await world.ready
    await hold(world)
    const device = (
      canvas.getContext('webgpu') as unknown as { getConfiguration(): { device: GPUDevice } }
    ).getConfiguration().device
    const images: MotionReading['images'] = []
    let width = 0,
      height = 0
    for (const pose of motionPoses(c)) {
      world.camera.set({ position: [...pose.eye], target: [...pose.target], fov: pose.fov })
      await animationFrame()
      const target = latestMade(textures, (label) =>
        /^Trillion3D reflection( @t3d:\d+)?$/.test(label),
      )
      if (!target) throw new Error('no reflection target')
      ;({ width, height } = target)
      const raw = await readTexture(device, target, 8)
      const half = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2)
      const samples: number[] = []
      for (let j = GRID >> 1; j < height; j += GRID)
        for (let i = GRID >> 1; i < width; i += GRID) {
          const at = (j * width + i) * 4
          samples.push(fromHalf(half[at]), fromHalf(half[at + 1]), fromHalf(half[at + 2]))
        }
      images.push({ samples, left: (await traceCounters(device, made))?.left ?? 0 })
    }
    Object.assign(result, { width, height, images, worldErrors: errors })
    world.dispose()
    canvas.remove()
  })
