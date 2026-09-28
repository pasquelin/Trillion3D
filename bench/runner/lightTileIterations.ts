// Light iterations per covered pixel on the audit's open city (#924, OMB-03), and the cost model
// the audit priced them with, carried with the coverage. COUNTED on the CPU oracle of the tile
// pass, never timed on a GPU: the milliseconds are a MODEL (declared assumptions below), not a
// frame time nor an FPS gain.
//
//   node bench/runner/lightTileIterations.ts [--width 1920] [--height 1080] [--views survey150]
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import {
  camera,
  type Vec3,
} from '../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import { buildCity, depthField } from './lightTileCity.ts';
import { countView } from './lightTileCount.ts';

const deg = (d: number) => (d * Math.PI) / 180;
/** The audit's five views (`t03_tiles_sim.py`, `t03b_tiles_views.py`), 60° vertical field. Its
 *  yaw turns toward +x, the engine's toward −x: the sign is flipped. */
export const CITY_VIEWS: Record<string, { eye: Vec3; yaw: number; pitch: number }> = {
  street: { eye: [34, 1.8, 10], yaw: -deg(30), pitch: deg(-2) },
  raised60: { eye: [0, 60, 0], yaw: -deg(45), pitch: deg(-15) },
  avenue: { eye: [34, 1.8, 0], yaw: 0, pitch: deg(-1) },
  survey150: { eye: [0, 150, 300], yaw: -deg(20), pitch: deg(-5) },
  roof30: { eye: [-100, 30, 50], yaw: -deg(60), pitch: deg(-8) },
};

/**
 * The audit's GPU classes and cost hypotheses (`model/gains.py`), unchanged: effective throughput
 * = lanes × clock × `EFFICIENCY`, and `INSTRUCTIONS_PER_ITERATION` lane instructions per light
 * walked — the cost of a light out of range, a lower bound. What the audit got wrong is not these
 * but the pixels: its iterations are per covered pixel, and it multiplied them by every pixel.
 */
export const COST_MODEL = {
  EFFICIENCY: 0.5,
  INSTRUCTIONS_PER_ITERATION: 20,
  classes: {
    A: { name: 'Intel UHD 620 / Iris Xe', lanes: 192, ghz: 1.0, pixels: 1920 * 1080 },
    B: { name: 'Apple M1 (8 GPU cores)', lanes: 1024, ghz: 1.278, pixels: 1920 * 1080 },
    C: { name: 'RTX 3060 / RX 6600', lanes: 3584, ghz: 1.78, pixels: 2560 * 1440 },
    D: { name: 'Adreno 6xx / Mali-G7x', lanes: 512, ghz: 0.6, pixels: 1920 * 1080 },
  },
};

/** Modelled milliseconds of `perCoveredPixel` iterations over a class's covered pixels. */
export function modelMs(
  gpu: { lanes: number; ghz: number; pixels: number },
  coverage: number,
  perCoveredPixel: number,
) {
  const instructions =
    gpu.pixels * coverage * perCoveredPixel * COST_MODEL.INSTRUCTIONS_PER_ITERATION;
  return (instructions / (gpu.lanes * gpu.ghz * 1e9 * COST_MODEL.EFFICIENCY)) * 1e3;
}

async function main() {
  const { values } = parseArgs({
    options: {
      width: { type: 'string', default: '1920' },
      height: { type: 'string', default: '1080' },
      views: { type: 'string', default: Object.keys(CITY_VIEWS).join(',') },
    },
  });
  const [width, height] = [Number(values.width), Number(values.height)];
  assert.ok(Number.isInteger(width) && Number.isInteger(height), '--width and --height: integers');
  const city = buildCity();
  console.log(`Open city: ${city.blocks.size} buildings, ${city.lights.length} lights + the sun`);
  const counts = [],
    model = [];
  for (const name of values.views.split(',')) {
    const pose = CITY_VIEWS[name];
    assert.ok(pose, `unknown view ${name}`);
    const view = camera(pose.eye, pose.yaw, pose.pitch, 60, width, height);
    const result = countView(view, depthField(city, view), city.lights);
    const it = result.perCoveredPixel;
    counts.push({
      view: name,
      'covered px': result.covered,
      coverage: `${(100 * result.coverage).toFixed(1)} %`,
      tiles: result.tiles,
      'tiles > 64 (box)': result.overflowingTilesBefore,
      'box, all past 64': it.beforeAllPastList.toFixed(2),
      'box, pool': it.before.toFixed(2),
      planes: it.after.toFixed(2),
      reach: it.reach.toFixed(2),
      missed: result.missed,
    });
    for (const [key, gpu] of Object.entries(COST_MODEL.classes)) {
      const ms = (perCovered: number) => modelMs(gpu, result.coverage, perCovered);
      const [allPast, pool, after] = [it.beforeAllPastList, it.before, it.after].map(ms);
      model.push({
        view: name,
        class: key,
        'before, all past 64 (ms)': allPast.toFixed(3),
        'before, pool (ms)': pool.toFixed(3),
        'after (ms)': after.toFixed(3),
        'saving vs all past 64 (ms)': (allPast - after).toFixed(3),
        'saving vs pool (ms)': (pool - after).toFixed(3),
      });
    }
  }
  console.log(`Light iterations per covered pixel, ${width} × ${height} (counted, CPU oracle):`);
  console.table(counts);
  console.log(
    `Cost MODEL (not measured): ${COST_MODEL.INSTRUCTIONS_PER_ITERATION} lane instructions per ` +
      `iteration, ${COST_MODEL.EFFICIENCY} of peak, each class's pixels × the view's coverage:`,
  );
  console.table(model);
}

if (import.meta.main) await main();
