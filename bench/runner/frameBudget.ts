// The whole frame of the boss's case, counted (#1369): sponza, 200 lamps, a moving camera, WebGPU,
// 1728 × 1117 at DPR 2 — 3456 × 2234, the bench's scale 1 —, the sponza-sized atrium standing for
// sponza's depth (`lightTileAtrium.ts`), the bench's own lamps (`lamps.ts`: a grid over the model's
// footprint two metres up, a range of 0.75 cell, each casting a shadow; the first 64 hold a slot,
// `MAX_SHADOW_SLICES`). Each stage's work is counted at the display, then priced at a rate taken from
// a measured number (`FRAME_RATES`): a MODEL, never a timing; the recette's timing after the merge
// is the proof. What no count here reaches is named in `UNCOUNTED`, never priced at zero in silence.
//
//   node bench/runner/frameBudget.ts [--pose 1]
import { parseArgs } from 'node:util';
import { MAX_SHADOW_SLICES } from '../../packages/sdk-core/src/scene/light/contracts.ts';
import { camera } from '../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import { ATRIUM_POSES, atriumDepth } from './lightTileAtrium.ts';
import { RESOLVE_GBUFFER, countGrid, gbufferAccesses, lightingModel } from './lightGridCount.ts';
import { countResolveWork } from './resolveWorkCount.ts';
import { countClassFragments } from './materialTileCount.ts';
import { countTaaFetches } from './taaFetchCount.ts';
import {
  CLASSES,
  DEMAND_MARKS,
  FRAME_RATES,
  PCF_GATHERS,
  SETUP_TEXELS,
  SPONZA_TRIANGLES,
  SURFACE_ACCESSES,
  UNCOUNTED,
  atriumBenchLamps,
  hizAccesses,
} from './frameBudgetRates.ts';

const DISPLAY = { width: 3456, height: 2234 };
type Row = { stage: string; work: string; count: number; ms: number };

/** Each stage's counted work at `width` × `height`, pose `pose`, and its modelled milliseconds. */
export function frameBudget(pose = 1, width = DISPLAY.width, height = DISPLAY.height) {
  const r = FRAME_RATES,
    N = width * height;
  const texels = (count: number) => (count * r.texelPs) / 1e9;
  const { eye, yaw, pitch } = ATRIUM_POSES[pose];
  const view = camera(eye, yaw, pitch, 60, width, height);
  const layers = new Uint16Array(N);
  const depths = atriumDepth(view, undefined, undefined, layers);
  const fragments = layers.reduce((a, b) => a + b, 0);
  const lamps = atriumBenchLamps();
  const grid = countGrid(view, depths, lamps);
  const work = countResolveWork(
    view,
    depths,
    lamps,
    lamps.map((_, rank) => rank < MAX_SHADOW_SLICES),
  ).after;
  const material = countClassFragments(width, height, CLASSES, pose);
  const surface = Object.values(SURFACE_ACCESSES).reduce((a, b) => a + b, 0);
  const gbuffer = gbufferAccesses(RESOLVE_GBUFFER.after).texels;
  const model = lightingModel(grid);
  const taa = countTaaFetches(1, false).fetches;
  const C = grid.covered;
  const hiz = hizAccesses(width, height);
  /** A stage's row: its count, priced as texels unless its own rate is given. */
  const row = (stage: string, work: string, count: number, ms = texels(count)): Row => ({
    stage,
    work,
    count,
    ms,
  });
  const rows: Row[] = [
    row('visibility', 'clear, two targets', 2 * N),
    row('visibility', 'raster fragments × 3 (depth test, depth, id)', 3 * fragments),
    row('visibility', 'triangles', SPONZA_TRIANGLES, (SPONZA_TRIANGLES * r.trianglePs) / 1e9),
    row('visibility', 'Hi-Z pyramid texels', hiz),
    row('materials', 'material depth and tile classification, 3 a pixel', 3 * N),
    row('materials', 'class fragments tested', material.tiled * N),
    row('materials', `surface accesses, ${surface} a covered pixel`, surface * C),
    row('lighting', 'light grid pass (`lightingModel`)', grid.work.columnTests, model.tilePass),
    row('lighting', `G-buffer, ${gbuffer} a covered pixel`, gbuffer * C, model.gbuffer),
    row('lighting', 'lights shaded', work.shaded, (work.shaded * r.shadedPs) / 1e9),
    row(
      'lighting',
      'lights weighed by the moving draw',
      work.weights,
      (work.weights * r.weightPs) / 1e9,
    ),
    row(
      'lighting',
      `shadow setups, ${SETUP_TEXELS} texels`,
      work.setup,
      texels(work.setup * SETUP_TEXELS),
    ),
    row(
      'shadows',
      `shadow reads, ${PCF_GATHERS} gathers`,
      work.shadows,
      texels(work.shadows * PCF_GATHERS),
    ),
    row(
      'shadows',
      'demand: flags a pixel, setup and marks where a slot reaches',
      N,
      texels(N + work.setup * (SETUP_TEXELS + 3) + work.demand * DEMAND_MARKS),
    ),
    row('antialiasing', `TAA texels, ${taa} a display pixel`, taa * N),
    row('present', 'HDR read, display write', 2 * N),
  ];
  return { rows, covered: C, total: rows.reduce((sum, row) => sum + row.ms, 0) };
}

async function main() {
  const { values } = parseArgs({ options: { pose: { type: 'string', default: '1' } } });
  const { rows, covered, total } = frameBudget(Number(values.pose));
  console.log(`Boss's case, atrium pose ${values.pose}, 3456 × 2234, ${covered} covered pixels:`);
  console.table(
    rows.map((row) => ({ ...row, count: Math.round(row.count), ms: row.ms.toFixed(3) })),
  );
  console.log(`Modelled frame: ${total.toFixed(2)} ms of 16.6. Not counted:`, UNCOUNTED);
}

if (import.meta.main) await main();
