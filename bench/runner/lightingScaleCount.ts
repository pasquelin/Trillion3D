// The lighting's cost at the internal resolution `renderScale: 'auto'` picks in the boss's case
// (#1369): Unreal's screen percentage, the lighting drawn below the display and the TSR-style
// history resolve reconstructing it. The pick is the engine's own controller
// (`frame/scaleController.ts`) fed the measured frame as its model has it, `F · s²`; a frame whose
// cost falls slower than its pixels only picks lower, so the pick is an upper bound. The tile pass,
// the light work and the non-light work of the resolve are then counted at the picked size from
// the only measured rates. COUNTED, never timed.
//
//   node bench/runner/lightingScaleCount.ts [--frame 24.5] [--refresh 120] [--range 4]
import { parseArgs } from 'node:util';
import { LIGHT_SETTINGS } from '../../packages/sdk-core/src/index.ts';
import {
  createScaleController,
  nextScale,
} from '../../packages/sdk-browser/src/frame/scaleController.ts';
import {
  MIN_RENDER_SCALE,
  renderExtent,
} from '../../packages/sdk-browser/src/frame/renderScaleOption.ts';
import { camera } from '../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import { ATRIUM_POSES, atriumDepth, atriumLamps } from './lightTileAtrium.ts';
import { countGrid } from './lightGridCount.ts';

/** The boss's display: 1728 × 1117 CSS at DPR 2. */
export const DISPLAY = [3456, 2234] as const;
/** Measured rates: the tile pass at the display (recette, develop), a light in and out of range per
 *  pixel in the program with no shadow code (#1326, docs/ENGINE.md), and a texel the TAA resolve
 *  reads or writes — its 1.30 ms over 19 texels a display pixel (docs/ENGINE.md, #1369). */
export const RATES = { tilePassMs: 1.21, inRangePs: 27.8, outOfRangePs: 10.6, texelPs: 8.86 };
/** What the resolve reads and writes a covered pixel beside its lights: five G-buffer texels and
 *  one write; an uncovered one reads its surface flag and leaves. */
const COVERED_TEXELS = 6,
  UNCOVERED_TEXELS = 1;

/** The scale `'auto'` settles at for a frame of `frameMs` at the display and a `budgetMs` refresh. */
export function pickedScale(frameMs: number, budgetMs: number) {
  const c = createScaleController(MIN_RENDER_SCALE, 1, budgetMs);
  for (let frame = 0; frame < 600; frame++) nextScale(c, frameMs * c.s ** 2);
  return c.s;
}

const tiles = (width: number, height: number) =>
  Math.ceil(width / LIGHT_SETTINGS.tileSize) * Math.ceil(height / LIGHT_SETTINGS.tileSize);

/** The lighting model, ms, of a `width` × `height` image `covered` pixels of which walk `listed`
 *  lights in all, `reach` of them in range (`countGrid`'s sums). */
export function lightingModel(
  width: number,
  height: number,
  { covered, listed, reach }: ReturnType<typeof countGrid>,
) {
  const tilePass = (RATES.tilePassMs * tiles(width, height)) / tiles(...DISPLAY);
  const lightWork = (reach * RATES.inRangePs + (listed - reach) * RATES.outOfRangePs) / 1e9;
  const texels = covered * COVERED_TEXELS + (width * height - covered) * UNCOVERED_TEXELS;
  const nonLight = (texels * RATES.texelPs) / 1e9;
  return { tilePass, lightWork, nonLight, sum: tilePass + lightWork + nonLight };
}

function main() {
  const { values } = parseArgs({
    options: {
      frame: { type: 'string', default: '24.5' },
      refresh: { type: 'string', default: '120' },
      range: { type: 'string', default: '4' },
    },
  });
  const [frame, refresh, range] = [values.frame, values.refresh, values.range].map(Number);
  const scale = pickedScale(frame, 1000 / refresh);
  const [width, height] = DISPLAY.map((axis) => renderExtent(axis, scale));
  const lights = atriumLamps(200, range);
  const rows = ATRIUM_POSES.map(({ eye, yaw, pitch }, pose) => {
    const view = camera(eye, yaw, pitch, 60, width, height);
    const s = countGrid(view, atriumDepth(view), lights);
    const model = lightingModel(width, height, s);
    return {
      pose,
      covered: (s.covered / (width * height)).toFixed(2),
      listed: (s.listed / s.covered).toFixed(2),
      reach: (s.reach / s.covered).toFixed(2),
      ...Object.fromEntries(Object.entries(model).map(([k, v]) => [k, v.toFixed(2)])),
    };
  });
  console.log(
    `${frame} ms at ${DISPLAY.join(' × ')}, ${refresh} Hz: 'auto' picks ${scale.toFixed(3)}, ` +
      `${width} × ${height}; 200 unshadowed lamps of range ${range} m, lighting ms:`,
  );
  console.table(rows);
}

if (import.meta.main) main();
