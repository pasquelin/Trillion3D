// Texels the temporal resolve reads per display pixel of a MOVING image (#1369), the shipped
// resolves run in JavaScript (`upscaleRun.fixture.ts`), every load, filtered sample and gather
// counted: at the display's size, and reconstructing a frame drawn at half of it per axis, the
// scale `renderScale: 'auto'` reaches under load. A pixel that still shows what it showed, and one
// uncovered (its history held a placement none of its 3×3 shows). COUNTED, never timed.
//
//   node bench/runner/taaFetchCount.ts
import {
  upscaleRun,
  type UpscaleFrame,
} from '../../packages/sdk-browser/src/taa/upscaleRun.fixture.ts';

const DISPLAY = 16;

/** Mean fetches and identifier reads per display pixel of a moving frame drawn at `scale`. */
export function countTaaFetches(scale: number, uncovered: boolean, asIs = false) {
  const render = DISPLAY * scale;
  let ids = 0;
  const frame: UpscaleFrame = {
    render: [render, render],
    display: [DISPLAY, DISPLAY],
    color: (x, y) => [(x % 3) / 3, (y % 5) / 5, 0.5, 1],
    depth: (x, y) => 0.1 + ((x + y) % 4) / 10,
    id: () => (ids++, 1 << 8),
    history: () => [0.4, 0.4, 0.4, 1],
    moving: true,
    // The placement every texel shows is tag 1: history texels of tag 2 were something else.
    tags: () => [uncovered ? 2 : 1, 2, 2, 2].map((tag) => tag / 255),
  };
  const run = upscaleRun(frame, asIs, false, scale === 1);
  let fetches = 0;
  for (let y = 0; y < DISPLAY; y++) for (let x = 0; x < DISPLAY; x++) fetches += run(x, y).fetches;
  const pixels = DISPLAY * DISPLAY;
  return { fetches: fetches / pixels, ids: ids / pixels };
}

function main() {
  const rows = [1, 0.5].flatMap((scale) =>
    [false, true].map((uncovered) => {
      const { fetches, ids } = countTaaFetches(scale, uncovered);
      return { scale, pixel: uncovered ? 'uncovered' : 'kept', fetches, ids };
    }),
  );
  console.log('Moving image, flagless resolve: reads per display pixel');
  console.table(rows);
}

if (import.meta.main) main();
