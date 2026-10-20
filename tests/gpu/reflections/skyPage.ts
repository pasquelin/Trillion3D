// A glass pane under an open sky, over a floor (`boxFrame.ts`): a polished vertical pane facing the
// eye, whose mirror ray rises where the pane stands above the eye and meets nothing the screen or a
// proxy holds — it leaves the scene, to the sky. What it reflects is what the screen draws there,
// times its weight: the background — the declared one, or the engine's default where none is
// declared (`RASTER_BACKGROUND`) — whatever light is declared around the scene.
import {
  addUniformIrradiance,
  emptyIrradiance,
} from '../../../packages/sdk-core/src/scene/core/environment.ts'
import { faceIndex } from '../../../packages/sdk-browser/src/reflections/boxes.fixture.ts'
import { runOnDevice } from '../../kit/device/deviceProof.ts'
import { boxFrame, type Block } from './boxFrame.ts'
import { settledImage } from './rigImage.ts'
import { rgbAt } from './rigFrame.ts'
import { RASTER_BACKGROUND } from '../../../packages/sdk-browser/src/page/raster.ts'
import type { Vec3 } from '../../../packages/math/src/vector/vectorTuple.ts'

const WIDTH = 160,
  HEIGHT = 90
const EYE: Vec3 = [0, 1, 0],
  TARGET: Vec3 = [0, 1, -6]
/** The pane's front face: the high side of z. */
const FRONT = faceIndex(2, true)

/** A case: the sky shown, `0xrrggbb` as the display shows it (the engine's default when absent),
 *  the light declared around the scene (its uniform irradiance, none when absent) and the pane's
 *  roughness. */
export type SkyCase = { sky?: number; declared?: number; rough: number }

/** What the proof reads per case: the pane's smallest and largest reflected value, in its pixels,
 *  and how many. */
type SkyReading = { poses: { minimum: number; maximum: number; pixels: number }[] }

export function run(cases: SkyCase[]) {
  return runOnDevice<SkyReading>(async (device, _events, result) => {
    result.poses = []
    for (const { sky, declared, rough } of cases) {
      const blocks: Block[] = [
        { box: { low: [-10, -0.5, -12], high: [10, 0, 2] }, color: [0.4, 0.4, 0.4] },
        {
          box: { low: [-1.5, 0, -6], high: [1.5, 2, -5.96] },
          color: [0.2, 0.3, 0.4],
          mirror: true,
          rough,
        },
      ]
      const { frame, shown } = boxFrame(blocks, EYE, TARGET, WIDTH, HEIGHT)
      const environment =
        declared === undefined
          ? undefined
          : addUniformIrradiance(emptyIrradiance(), [declared, declared, declared])
      const words = await settledImage(device, {
        ...frame,
        background: sky ?? RASTER_BACKGROUND,
        environment,
      })
      let minimum = Infinity,
        maximum = 0,
        pixels = 0
      for (let p = 0; p < WIDTH * HEIGHT; p++) {
        // The pane's face above the eye, whose mirror ray rises: the floor lies the other way.
        if (shown[p] !== 6 + FRONT || Math.floor(p / WIDTH) >= HEIGHT / 2 - 3) continue
        pixels++
        for (const v of rgbAt(words, p)) {
          minimum = Math.min(minimum, v)
          maximum = Math.max(maximum, v)
        }
      }
      result.poses.push({ minimum, maximum, pixels })
    }
  })
}
