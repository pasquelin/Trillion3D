// Lights each covered pixel walks against those that reach it (#1369), and the tile pass's work:
// UE5's light grid — screen cells of `tileSize` pixels × `gridSlices` depth slices, `gridSlicesPerOctave`
// to a doubling of the view depth —, the lights culled once per image against each cell's own
// bounds, each pixel walking the list of its cell (`lighting/tiles`, their oracle
// `gpuLightGridOracle.ts`). `reach` counts, per pixel, the lights whose range holds its point: the
// floor no grid goes under; `missed`, those reaching it but not listed, is 0. COUNTED, never timed.
//
//   node bench/runner/lightGridCount.ts [--width 3456] [--height 2234] [--range 4] [--grids 64x48x4,...]
import { parseArgs } from 'node:util';
import { camera } from '../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import { GRID, type Grid, type TileView } from '../oracles/browser/gpuLightGridOracle.ts';
import { reaches, walkGrid } from './lightGridWalk.ts';
import { ATRIUM_POSES, atriumDepth, atriumLamps } from './lightTileAtrium.ts';
import type { Light } from './lightTileCity.ts';

/** Per covered pixel of `view`: the lights its cell lists, those reaching it, those missed. */
export function countGrid(view: TileView, depths: Float32Array, lights: Light[], grid = GRID) {
  const sums = { covered: 0, listed: 0, reach: 0, missed: 0 };
  const work = walkGrid(
    view,
    depths,
    lights,
    (p, listed) => {
      sums.covered++;
      sums.listed += listed.length;
      const listedSet = new Set(listed);
      lights.forEach((light, rank) => {
        if (!reaches(p, light)) return;
        sums.reach++;
        sums.missed += +!listedSet.has(rank);
      });
    },
    grid,
  );
  return { ...sums, work };
}

async function main() {
  const { values } = parseArgs({
    options: {
      width: { type: 'string', default: '3456' },
      height: { type: 'string', default: '2234' },
      range: { type: 'string', default: '4' },
      grids: { type: 'string', default: `${GRID.cell}x${GRID.slices}x${GRID.perOctave}` },
    },
  });
  const [width, height, range] = [values.width, values.height, values.range].map(Number);
  const grids: Grid[] = values.grids.split(',').map((g) => {
    const [cell, slices, perOctave] = g.split('x').map(Number);
    return { cell, slices, perOctave };
  });
  const lights = atriumLamps(200, range);
  const rows = ATRIUM_POSES.flatMap(({ eye, yaw, pitch }, pose) => {
    const view = camera(eye, yaw, pitch, 60, width, height);
    const depths = atriumDepth(view);
    return grids.map((grid) => {
      const s = countGrid(view, depths, lights, grid);
      return {
        pose,
        grid: `${grid.cell}x${grid.slices}x${grid.perOctave}`,
        listed: (s.listed / s.covered).toFixed(2),
        reach: (s.reach / s.covered).toFixed(2),
        missed: s.missed,
        columnTests: s.work.columnTests,
        cellTests: s.work.cellTests,
        kept: s.work.columnKept,
        cells: s.work.cells,
      };
    });
  });
  console.log(`200 lamps of range ${range} m, ${width} × ${height}, lights per covered pixel:`);
  console.table(rows);
}

if (import.meta.main) await main();
