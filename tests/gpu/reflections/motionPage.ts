// The page of the run-time proxy's motion proof: a case over a mirror floor (`motionPath.ts`) drawn at a
// size whose rays outnumber the frame's budget until it holds, then moved along its path one pose an image —
// the reflection target and the store's stamps read after each image (`motionGrid.ts`) —, then each pose
// drawn again until it holds, the settled image each moving one is judged against.
import { proofCanvas } from '../kit/renderHarness.ts'
import { animationFrame } from '../kit/frame.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { latestMade, listenToWorldDevices } from '../kit/worldErrors.ts'
import { familyWorld, traceCounters } from './runtimeFamilyWorld.ts'
import { hold } from './runtimeFamilyPage.ts'
import { motionCase, motionPoses } from './motionPath.ts'
import { judgeImage, newest, storeStamps, targetGrid, type Grid } from './motionGrid.ts'

/** What the proof reads, for each pose: its judgement (`judgeImage`) and the pixels the trace left. */
export type MotionReading = {
  images: (ReturnType<typeof judgeImage> & { left: number })[]
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
    const target = () => {
      const found = latestMade(textures, (label) =>
        /^Trillion3D reflection( @t3d:\d+)?$/.test(label),
      )
      if (!found) throw new Error('no reflection target')
      return found
    }
    const store = latestMade(textures, (label) =>
      label.startsWith('Trillion3D run-time proxy store'),
    )
    if (!store) throw new Error('no run-time proxy store')
    const poses = motionPoses(c)
    const moving: { grid: Grid; stamps: Uint8Array; stamp: number; left: number }[] = []
    for (const pose of poses) {
      world.camera.set({ position: [...pose.eye], target: [...pose.target], fov: pose.fov })
      await animationFrame()
      const grid = await targetGrid(device, target())
      const sets = await storeStamps(device, store)
      const { stamp, set } = newest(sets)
      const left = (await traceCounters(device, made))?.left ?? 0
      moving.push({ grid, stamps: sets[set], stamp, left })
    }
    const images: MotionReading['images'] = []
    for (const [k, pose] of poses.entries()) {
      world.camera.set({ position: [...pose.eye], target: [...pose.target], fov: pose.fov })
      await hold(world)
      const { grid, stamps, stamp, left } = moving[k]
      const judged = judgeImage(grid, await targetGrid(device, target()), stamps, stamp)
      images.push({
        judged: judged.judged,
        dark: judged.dark,
        all: judged.all,
        darkBy: judged.darkBy,
        left,
      })
    }
    Object.assign(result, { images, worldErrors: errors })
    world.dispose()
    canvas.remove()
  })
