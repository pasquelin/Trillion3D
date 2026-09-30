// Lights each covered pixel walks against those that reach it (#1369): the tile pass's opaque lists
// (`lighting/tiles`, their bounds from the pass's oracle) are UE5's light grid in its 2.5D form —
// a cell per screen tile, fitted to the depths its pixels hold, the lights culled into it once per
// image, each pixel walking its cell's list. `reach` counts, per pixel, the lights whose range
// holds its point: the floor no finer grid — depth slices, froxels, a per-pixel mask — can go
// under. COUNTED, never timed.
//
//   node bench/runner/lightGridCount.ts [--width 3456] [--height 2234] [--range 4]
import { parseArgs } from 'node:util';
import { LIGHT_SETTINGS } from '../../packages/sdk-core/src/index.ts';
import {
  camera,
  pixelPoint,
} from '../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import {
  sliceHits,
  toTileFrame,
  type TileView,
} from '../oracles/browser/gpuLightTileColumnOracle.ts';
import { coveredTile } from './lightTileCount.ts';
import { ATRIUM_POSES, atriumDepth, atriumLamps } from './lightTileAtrium.ts';
import type { Light } from './lightTileCity.ts';

const SIZE = LIGHT_SETTINGS.tileSize;

/** Per covered pixel of `view`: the lights its tile's opaque list holds, and those reaching it. */
export function countGrid(view: TileView, depths: Float32Array, lights: Light[]) {
  const sums = { covered: 0, listed: 0, reach: 0 };
  for (let ty = 0; ty < Math.ceil(view.height / SIZE); ty++)
    for (let tx = 0; tx < Math.ceil(view.width / SIZE); tx++) {
      const covered = coveredTile(view, [tx, ty], depths);
      if (!covered) continue;
      const { pixels, bounds } = covered;
      const listed = lights.filter(
        ({ centre, radius }) => sliceHits(bounds, toTileFrame(view, centre), radius).opaque,
      );
      sums.covered += pixels.length;
      sums.listed += pixels.length * listed.length;
      for (const [x, y, z] of pixels) {
        const p = pixelPoint(view, x, y, z);
        for (const { centre: c, radius } of listed)
          sums.reach += +(
            (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2 <
            radius ** 2
          );
      }
    }
  return sums;
}

async function main() {
  const { values } = parseArgs({
    options: {
      width: { type: 'string', default: '3456' },
      height: { type: 'string', default: '2234' },
      range: { type: 'string', default: '4' },
    },
  });
  const [width, height, range] = [values.width, values.height, values.range].map(Number);
  const lights = atriumLamps(200, range);
  const rows = ATRIUM_POSES.map(({ eye, yaw, pitch }, pose) => {
    const view = camera(eye, yaw, pitch, 60, width, height);
    const s = countGrid(view, atriumDepth(view), lights);
    return {
      pose,
      listed: (s.listed / s.covered).toFixed(2),
      reach: (s.reach / s.covered).toFixed(2),
    };
  });
  console.log(`200 lamps of range ${range} m, ${width} × ${height}, lights per covered pixel:`);
  console.table(rows);
}

if (import.meta.main) await main();
