// Fetches the temporal resolve issues per display pixel of a moving and of a still image (#1369),
// the shipped resolves run in JavaScript (`upscaleRun.fixture.ts`), every load, filtered sample
// and gather counted one: at the display's size, and reconstructing a frame drawn at half of it per
// axis, the scale `renderScale: 'auto'` reaches under load. A pixel that still shows what it
// showed, and one uncovered (its geometry history holds another placement). The fragment resolve
// that ships, which fetches its render texels per pixel. COUNTED, never timed.
//
//   node bench/runner/counts/taaFetchCount.ts
import {
  upscaleRun,
  type UpscaleFrame,
} from '../../../packages/sdk-browser/src/taa/upscaleRun.fixture.ts'

const DISPLAY = 16

/** Mean fetches per display pixel of a frame drawn at `scale`, `moving` or still, by the flagless
 *  or the `asIs` resolve; `reactive`, a frame whose blends wrote a reactive value, otherwise none
 *  (`resolve.ts`, `unreactive`): the fragment resolve's, and its identifier reads. */
export function countTaaFetches(
  scale: number,
  uncovered: boolean,
  asIs = false,
  moving = true,
  reactive = false,
) {
  const render = DISPLAY * scale
  let ids = 0
  const frame: UpscaleFrame = {
    render: [render, render],
    display: [DISPLAY, DISPLAY],
    color: (x, y) => [(x % 3) / 3, (y % 5) / 5, 0.5, 1],
    depth: (x, y) => 0.1 + ((x + y) % 4) / 10,
    id: () => (ids++, 1 << 8),
    history: () => [0.4, 0.4, 0.4, 1],
    moving,
    reactive: reactive ? () => 0 : undefined,
    // Every texel shows placement 0, identity 1 in the geometry history: identity 2 was another.
    tags: () => [(uncovered ? 2 : 1) / 255, 0, 0, 1],
  }
  const run = upscaleRun(frame, asIs, false, scale === 1)
  let fetches = 0
  for (let y = 0; y < DISPLAY; y++) for (let x = 0; x < DISPLAY; x++) fetches += run(x, y).fetches
  return { fetches: fetches / (DISPLAY * DISPLAY), ids: ids / (DISPLAY * DISPLAY) }
}

function main() {
  const rows = [true, false].flatMap((moving) =>
    [1, 0.5].flatMap((scale) =>
      [false, true].map((uncovered) => ({
        moving,
        scale,
        pixel: uncovered ? 'uncovered' : 'kept',
        ...countTaaFetches(scale, uncovered, false, moving),
      })),
    ),
  )
  console.log('Flagless resolve: fetches per display pixel')
  console.table(rows)
}

if (import.meta.main) main()
