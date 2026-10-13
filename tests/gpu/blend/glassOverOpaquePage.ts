// Page of the glass proof: the real WebGPU engine lit by the bench sun (`sunlitEngine`) on the
// kit's backdrop scene (`backdropScene.ts`), an opaque blue backdrop filling the view. Over it, a
// clear glass square; the same glass with a red volume; an opaque red tile in front of the glass,
// and the same tile without the glass; the glass moved out of view; and the backdrop alone.
import { cameraFace } from '../kit/sharedSceneProof.ts'
import { backdropScene, type Backdrop } from '../kit/backdropScene.ts'
import { colorAt, difference, sunlitEngine, untilHeld } from '../kit/sceneImageProof.ts'
import { runOnDevice } from '../kit/deviceProof.ts'

/** The held image of `layout`: its pixels at the centre, and all of them (kept in the page). */
async function imageOf(device: GPUDevice, events: unknown[], layout: Backdrop) {
  const camera = cameraFace()
  const { backend, release } = await sunlitEngine(backdropScene(layout), device, events)
  try {
    const { held, rendered } = await untilHeld(backend, camera)
    const pixels = Uint8Array.from(held ?? rendered ?? [])
    return { held: held !== null, centre: colorAt(pixels, camera, 0, 0), pixels }
  } finally {
    await release()
  }
}

/** What a layout's image tells the proof: whether it held, and its centre. */
type Image = { held: boolean; centre: number[] }
/** Every layout's image, by name; and how many pixels the glass out of view changed of the
 *  backdrop's image, the one comparison of whole images, made here. */
export type Images = Record<
  'bare' | 'clear' | 'volume' | 'front' | 'frontAlone' | 'away',
  Image
> & {
  awayChanged: number
}

export const run = () =>
  runOnDevice<Images>(async (device, events, result) => {
    const shot = async (layout: Backdrop) => {
      const { held, centre, pixels } = await imageOf(device, events, layout)
      return { image: { held, centre }, pixels }
    }
    const bare = await shot({})
    result.bare = bare.image
    result.clear = (await shot({ glass: { at: 0, volume: false } })).image
    result.volume = (await shot({ glass: { at: 0, volume: true } })).image
    result.front = (await shot({ glass: { at: 0, volume: false }, tile: true })).image
    result.frontAlone = (await shot({ tile: true })).image
    const away = await shot({ glass: { at: 40, volume: false } })
    result.away = away.image
    result.awayChanged = difference(away.pixels, bare.pixels)
  })
