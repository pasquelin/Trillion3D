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

export const DISPLAY = { width: 3456, height: 2234 };
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
  const taa = countTaaFetches(1, false).fetches;
  const C = grid.covered;
  const rows: Row[] = [
    { stage: 'visibility', work: 'clear, two targets', count: 2 * N, ms: texels(2 * N) },
    {
      stage: 'visibility',
      work: 'raster fragments × 3 (depth test, depth, id)',
      count: 3 * fragments,
      ms: texels(3 * fragments),
    },
    {
      stage: 'visibility',
      work: 'triangles',
      count: SPONZA_TRIANGLES,
      ms: (SPONZA_TRIANGLES * r.trianglePs) / 1e9,
    },
    {
      stage: 'visibility',
      work: 'Hi-Z pyramid texels',
      count: hizAccesses(width, height),
      ms: texels(hizAccesses(width, height)),
    },
    {
      stage: 'materials',
      work: 'material depth and tile classification, 3 a pixel',
      count: 3 * N,
      ms: texels(3 * N),
    },
    {
      stage: 'materials',
      work: 'class fragments tested',
      count: material.tiled * N,
      ms: texels(material.tiled * N),
    },
    {
      stage: 'materials',
      work: `surface accesses, ${surface} a covered pixel`,
      count: surface * C,
      ms: texels(surface * C),
    },
    {
      stage: 'lighting',
      work: 'light grid pass (`lightingModel`)',
      count: grid.work.columnTests,
      ms: lightingModel(grid).tilePass,
    },
    {
      stage: 'lighting',
      work: `G-buffer, ${gbuffer} a covered pixel`,
      count: gbuffer * C,
      ms: texels(gbuffer * C),
    },
    {
      stage: 'lighting',
      work: 'lights shaded',
      count: work.shaded,
      ms: (work.shaded * r.shadedPs) / 1e9,
    },
    {
      stage: 'lighting',
      work: 'lights weighed by the moving draw',
      count: work.weights,
      ms: (work.weights * r.weightPs) / 1e9,
    },
    {
      stage: 'lighting',
      work: `shadow setups, ${SETUP_TEXELS} texels`,
      count: work.setup,
      ms: texels(work.setup * SETUP_TEXELS),
    },
    {
      stage: 'shadows',
      work: `shadow reads, ${PCF_GATHERS} gathers`,
      count: work.shadows,
      ms: texels(work.shadows * PCF_GATHERS),
    },
    {
      stage: 'shadows',
      work: 'demand: flags a pixel, setup and marks where a slot reaches',
      count: N,
      ms: texels(N + work.setup * (SETUP_TEXELS + 3) + work.demand * DEMAND_MARKS),
    },
    {
      stage: 'antialiasing',
      work: `TAA texels, ${taa} a display pixel`,
      count: taa * N,
      ms: texels(taa * N),
    },
    { stage: 'present', work: 'HDR read, display write', count: 2 * N, ms: texels(2 * N) },
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
