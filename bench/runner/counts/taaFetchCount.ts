// Fetches the temporal resolve issues per display pixel of a moving and of a still image,
// the shipped resolves run in JavaScript (`upscaleRun.fixture.ts`), every load, filtered sample
// and gather counted one: at the display's size, and reconstructing a frame drawn at half of it per
// axis, the scale `renderScale: 'auto'` reaches under load. A pixel that keeps its history, and
// one that refuses it (its last position off the last view). The fragment resolve that ships,
// which fetches its render texels per pixel. COUNTED, never timed.
//
//   node bench/runner/counts/taaFetchCount.ts
import {
  upscaleRun,
  type UpscaleFrame,
} from '../../../packages/sdk-browser/src/taa/upscaleRun.fixture.ts'
import { Mat } from '../../../packages/sdk-browser/src/texture/shaderRunMatrix.fixture.ts'
import { IDENTITY_MATRIX4 } from '../../../packages/math/src/matrix/matrix4.ts'

const DISPLAY = 16

/** The last view `ndc` to the right: every surface slides alike. */
const shifted = (ndc: number) =>
  new Mat([...IDENTITY_MATRIX4].map((value, i) => (i === 12 ? ndc : value)))

/** Mean fetches per display pixel of a frame drawn at `scale`, `moving` (the last view 0.4 of a
 *  display pixel aside, every pixel's last position still in it) or still, by the flagless or the `asIs` resolve, every pixel `refused` (the last
 *  view far aside) or none: the fragment resolve's, and the identifier texels it reads. A frame
 *  whose blends wrote no reactive value binds a blank one, read the same (`inputs.ts`,
 *  `noReactive`). */
export function countTaaFetches(scale: number, refused: boolean, asIs = false, moving = true) {
  const render = DISPLAY * scale
  let ids = 0
  const frame: UpscaleFrame = {
    render: [render, render],
    display: [DISPLAY, DISPLAY],
    color: (x, y) => [(x % 3) / 3, (y % 5) / 5, 0.5, 1],
    depth: (x, y) => 0.1 + ((x + y) % 4) / 10,
    id: () => (ids++, 1 << 8),
    history: () => [0.4, 0.4, 0.4, 1],
    ...(refused ? { prevViewProj: shifted(4) } : moving ? { prevViewProj: shifted(0.05) } : {}),
  }
  const run = upscaleRun(frame, asIs, false)
  let fetches = 0
  for (let y = 0; y < DISPLAY; y++) for (let x = 0; x < DISPLAY; x++) fetches += run(x, y).fetches
  return { fetches: fetches / (DISPLAY * DISPLAY), ids: ids / (DISPLAY * DISPLAY) }
}

function main() {
  const rows = [true, false].flatMap((moving) =>
    [1, 0.5].flatMap((scale) =>
      [false, true].map((refused) => ({
        moving,
        scale,
        pixel: refused ? 'refused' : 'kept',
        ...countTaaFetches(scale, refused, false, moving),
      })),
    ),
  )
  console.log('Flagless resolve: fetches per display pixel')
  console.table(rows)
}

if (import.meta.main) main()
