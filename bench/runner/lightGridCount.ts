// Lights each covered pixel walks against those that reach it (#1369), and the grid pass's work:
// UE5's light grid — cells of `tileSize` pixels across and `gridSlices` slices of depth,
// `gridSlicesPerOctave` to a doubling of the view depth —, the lights culled once per image against
// each cell's own bounds, each pixel walking its cell's list (`lighting/tiles`, their oracle
// `gpuLightGridOracle.ts`). `reach` counts, per pixel, the lights whose range holds its point: the
// floor no grid goes under; `missed`, those reaching it but not listed, is 0 (among the lights
// within its column's planes, which alone can reach it). Develop's tile pass beside it: its depth
// texels and tile × light tests. COUNTED, never timed.
//
//   node bench/runner/lightGridCount.ts [--width 3456] [--height 2234] [--range 4]
import { parseArgs } from 'node:util';
import { camera } from '../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import type { TileView } from '../oracles/browser/gpuLightGridOracle.ts';
import { reaches, tilePassWork, walkGrid } from './lightGridWalk.ts';
import { ATRIUM_POSES, atriumDepth, atriumLamps } from './lightTileAtrium.ts';
import type { Light } from './lightTileCity.ts';

/** Over the covered pixels of `view`: the lights their cells list, those reaching them, those
 *  missed; and the grid pass's work. */
export function countGrid(view: TileView, depths: Float32Array, lights: Light[]) {
  const sums = { covered: 0, listed: 0, reach: 0, missed: 0 };
  const work = walkGrid(view, depths, lights, (p, listed, within) => {
    sums.covered++;
    sums.listed += listed.length;
    for (const rank of within) {
      if (!reaches(p, lights[rank])) continue;
      sums.reach++;
      sums.missed += +!listed.includes(rank);
    }
  });
  return { ...sums, work };
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
      covered: s.covered,
      listed: (s.listed / s.covered).toFixed(2),
      reach: (s.reach / s.covered).toFixed(2),
      missed: s.missed,
      ...s.work,
    };
  });
  console.log(`200 lamps of range ${range} m, ${width} × ${height}: lights per covered pixel`);
  console.table(rows);
  console.log("Develop's tile pass (#924) at the same size:", tilePassWork(width, height, 200));
}

if (import.meta.main) await main();
