// The reflections of a still view settle only on a lit image that no longer changes. A mirror floor
// and an emissive quad (`mirrorScene.ts`, `rig.ts`) are drawn, image after image, until the view
// is settled (`reflectionsSettled`): the images drawn, as a frame loop draws them while anything is
// unsettled, and the reflection target the last of them leaves. Then the quad's light changes with
// the camera still, and the loop runs again to the next settled view. A view that never saw the
// first light and starts on the second is the cold converged image: the held one is it, to the bit.
import { runOnDevice } from '../kit/deviceProof.ts'
import { animationFrame } from '../kit/onDawn.ts'
import { openMirror } from './mirrorPage.ts'
import { MIRROR, mirrorScene } from './mirrorScene.ts'
import type { openRig } from './rig.ts'

/** What the proof reads: the images each loop drew and the target it held, as raw half words. */
export type SettleReading = {
  first: { images: number; target: number[] }
  /** The target of the first image drawn after the change: the lit image it reflects is the old one. */
  lagging: number[]
  changed: { images: number; target: number[] }
  cold: { images: number; target: number[] }
}

/** The quad's light, `scale` times its colour. */
function frameLitBy(scale: number) {
  const scene = mirrorScene()
  const { size, quad } = MIRROR
  // The quad's lit pixels are the ones of its colour; the floor's own colour stays.
  for (let p = 0; p < size * size; p++)
    if (scene.flags[p] === 4)
      for (let c = 0; c < 3; c++) scene.radiance[p * 4 + c] = quad[c] * scale
  return scene
}

/** Images drawn until the view is settled, a frame loop's: one in each animation frame of the
 *  page, the hash of the lit image coming back some frames later. */
async function untilSettled(rig: Awaited<ReturnType<typeof openRig>>, limit = 60) {
  let images = 0
  while (!rig.settled() && images < limit) {
    rig.image()
    images++
    await animationFrame()
  }
  if (!rig.settled()) throw new Error(`the view never settled in ${limit} images`)
  return images
}

export function run() {
  return runOnDevice<SettleReading>(async (device, _events, result) => {
    const open = async (scale: number) => {
      const rig = await openMirror(device, frameLitBy(scale))
      return { rig }
    }
    const { rig } = await open(1)
    const first = await untilSettled(rig)
    result.first = { images: first, target: Array.from(await rig.read()) }
    // The light doubles, the camera still: the lit image changes, one image is drawn for it.
    const bright = frameLitBy(2)
    rig.light(bright.radiance)
    rig.image()
    result.lagging = Array.from(await rig.read())
    result.changed = { images: 1 + (await untilSettled(rig)), target: [] }
    result.changed.target = Array.from(await rig.read())
    rig.dispose()
    const cold = await open(2)
    const images = await untilSettled(cold.rig)
    result.cold = { images, target: Array.from(await cold.rig.read()) }
    cold.rig.dispose()
  })
}
