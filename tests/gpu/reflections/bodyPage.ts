// A thick toothed body between the eye and a mirror wall (`boxFrame.ts`, `rig.ts`): the wall's
// mirror rays come toward the eye and pass through the body, behind the front the screen sees. A
// wall pixel whose exact ray meets the body, away from the body's silhouette, must show the body's
// colour — the reflection of a body is continuous, never the shards of its edges the ray happens to
// meet inside a thin slab.
import type { V3 } from '../../../packages/sdk-browser/src/reflections/boxes.fixture.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import type { Block } from './boxFrame.ts'
import { exactRays, hitOnScreen, hueOf, interior, renderBlocks } from './rayAudit.ts'

const WIDTH = 320,
  HEIGHT = 180
const EYE: V3 = [3, 2.5, 5]
const TARGET: V3 = [0, 1.5, -8]

const WALL: Block = {
  box: { low: [-14, 0, -8.3], high: [14, 12, -8] },
  color: [1, 1, 1],
  mirror: true,
}
const FLOOR: Block = { box: { low: [-14, -0.3, -16], high: [14, 0, 6] }, color: [0.3, 0.3, 0.3] }
const BODY_COLOR: V3 = [0.9, 0.6, 0.1]
/** The body, 1.8 m thick, and four teeth along its top. */
const BODY: Block[] = [
  { box: { low: [-1.5, 0.3, -5], high: [1.5, 2.3, -3.2] }, color: BODY_COLOR },
  ...[-1.2, -0.4, 0.4, 1.2].map((x) => ({
    box: { low: [x - 0.2, 2.3, -5] as V3, high: [x + 0.2, 3, -3.2] as V3 },
    color: BODY_COLOR,
  })),
]
const BLOCKS = [WALL, FLOOR, ...BODY]
const [WALL_AT, , BODY_AT] = BLOCKS.keys()

export type BodyReading = {
  /** Wall pixels whose exact mirror ray meets the body in the open, and of them those showing its
   *  colour. */
  body: number
  bodyHue: number
}

export function run() {
  return runOnDevice<BodyReading>(async (device, _events, result) => {
    const { view, shown, rgb } = await renderBlocks(device, BLOCKS, EYE, TARGET, WIDTH, HEIGHT)
    const { exact, origins, mirrors, boxes } = exactRays(
      view,
      BLOCKS,
      EYE,
      shown,
      WALL_AT,
      [0, 0, 1e-4],
      (d) => [d[0], d[1], -d[2]],
    )
    result.body = result.bodyHue = 0
    for (let p = 0; p < WIDTH * HEIGHT; p++) {
      if (exact[p] < BODY_AT || !interior(exact, WIDTH, HEIGHT, p)) continue
      if (!hitOnScreen(view, boxes, origins[p], mirrors[p], p)) continue
      result.body++
      if (hueOf(rgb(p), BODY_COLOR) > 0.98) result.bodyHue++
    }
  })
}
