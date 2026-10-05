// Light evaluations per covered pixel of a MOVING image (#1249): the shipped `contractLighting`,
// run as JavaScript on each pixel's cell list as the light grid's oracle builds it
// (`lightGridWalk.ts`), its shadow flag the count's high bit the pass sets once, never a per-pixel
// walk. COUNTED, never timed. A full sum walks its `L` lights once; `sampledSliceLighting` walks a list of
// `LIGHT_SAMPLES` to `TILE_LIGHTS` lights twice — its two `lightWeight` loops (#1369) — then
// shades `LIGHT_SAMPLES` of them: `2·L + LIGHT_SAMPLES`.
//
//   node bench/runner/lightTileSampledCount.ts [--width 3456] [--height 2234]
import { parseArgs } from 'node:util';
import { directLightingWgsl } from '../../packages/sdk-browser/src/lighting/direct/lightingWgsl.ts';
import {
  shaderFunctions,
  wgslConstants,
} from '../../packages/sdk-browser/src/texture/shaderRule.fixture.ts';
import { camera } from '../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import type { TileView } from '../oracles/browser/gpuLightGridOracle.ts';
import { walkGrid } from './lightGridWalk.ts';
import { ATRIUM_POSES, atriumDepth, atriumLamps } from './lightTileAtrium.ts';
import type { Light } from './lightTileCity.ts';

const DIRECT_LIGHTING_WGSL = directLightingWgsl();

const K = wgslConstants(DIRECT_LIGHTING_WGSL);
type Contract = (...args: unknown[]) => unknown;

/**
 * Evaluations per covered pixel of `view` over `depths`, a sampled rank: `list` the lights of the
 * cells, `develop` the resolve before #1249 (every sampled rank drawn), `moving` the shipped one.
 * `slots[rank]` is each light's shadow slot, −1 for none.
 */
export function countSampled(
  view: TileView,
  depths: Float32Array,
  lights: Light[],
  slots: number[],
) {
  let evaluations = 0,
    kept = 0;
  const drawn = (L: number) =>
    L <= K.LIGHT_SAMPLES || L > K.TILE_LIGHTS ? L : 2 * L + K.LIGHT_SAMPLES;
  const { contractLighting } = shaderFunctions<{ contractLighting: Contract }>(
    DIRECT_LIGHTING_WGSL,
    ['contractLighting', 'sampledList'],
    {
      ...K,
      view: { viewport: { w: 1 } },
      vec3f: () => 0,
      cellSlice: () => ({ x: 0, y: kept }),
      sliceLighting: () => (evaluations += kept),
      sampledSliceLighting: () => (evaluations += drawn(kept)),
    },
  );
  const sums = { covered: 0, list: 0, develop: 0, moving: 0 };
  walkGrid(view, depths, lights, (_, listed) => {
    kept = listed.length;
    sums.covered++;
    sums.list += kept;
    sums.develop += drawn(kept);
    evaluations = 0;
    const shadowed = listed.some((rank) => slots[rank] > -1);
    contractLighting(0, 0, 0, 0, 0, 0, 0, { x: 0, y: 0 }, 0, shadowed);
    sums.moving += evaluations;
  });
  return sums;
}

async function main() {
  const { values } = parseArgs({
    options: {
      width: { type: 'string', default: '3456' },
      height: { type: 'string', default: '2234' },
    },
  });
  const [width, height] = [Number(values.width), Number(values.height)];
  const lights = atriumLamps(200, 4);
  const rows = ATRIUM_POSES.map((pose, index) => {
    const view = camera(pose.eye, pose.yaw, pose.pitch, 60, width, height);
    const s = countSampled(
      view,
      atriumDepth(view),
      lights,
      lights.map(() => -1),
    );
    const per = (n: number) => (n / s.covered).toFixed(2);
    return {
      pose: index,
      covered: s.covered,
      list: per(s.list),
      develop: per(s.develop),
      moving: per(s.moving),
    };
  });
  console.log(
    `Moving image, 200 unshadowed lamps of range 4 m, ${width} × ${height}, per covered pixel:`,
  );
  console.table(rows);
}

if (import.meta.main) await main();
