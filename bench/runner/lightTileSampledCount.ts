// Light evaluations per covered pixel of a MOVING image (#1249): the shipped `contractLighting`
// and `tileShadowed`, run as JavaScript on each tile's opaque list as the tile pass's oracle
// builds it — a record whose last word the pass sets once, never a per-pixel walk. COUNTED,
// never timed. A full sum walks its `L` lights once; `sampledTileLighting` walks a list of
// `LIGHT_SAMPLES` to `TILE_LIGHTS` lights three times — its three `lightWeight` loops — then
// shades `LIGHT_SAMPLES` of them: `3·L + LIGHT_SAMPLES`.
//
//   node bench/runner/lightTileSampledCount.ts [--width 3456] [--height 2234]
import { parseArgs } from 'node:util';
import { LIGHT_SETTINGS } from '../../packages/sdk-core/src/index.ts';
import { DIRECT_LIGHTING_WGSL } from '../../packages/sdk-browser/src/lighting/direct/lightingWgsl.ts';
import {
  shaderFunctions,
  wgslConstants,
} from '../../packages/sdk-browser/src/texture/shaderRule.fixture.ts';
import { camera } from '../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import {
  sliceHits,
  tileBounds,
  toTileFrame,
  type TileView,
} from '../oracles/browser/gpuLightTileColumnOracle.ts';
import { ATRIUM_POSES, atriumDepth, atriumLamps } from './lightTileAtrium.ts';
import type { Light } from './lightTileCity.ts';

const SIZE = LIGHT_SETTINGS.tileSize;
const K = wgslConstants(DIRECT_LIGHTING_WGSL);
type Contract = (...args: unknown[]) => unknown;

/** Each tile's record, the opaque list only: its count, its lights in rank order, and the run's
 *  flag word — one when a kept light carries a shadow slot (`slots[rank] > -1`, #1249). */
function tileRecords(view: TileView, depths: Float32Array, lights: Light[], slots: number[]) {
  const [tilesX, tilesY] = [Math.ceil(view.width / SIZE), Math.ceil(view.height / SIZE)];
  const records = new Uint32Array(tilesX * tilesY * K.TILE_STRIDE);
  for (let ty = 0; ty < tilesY; ty++)
    for (let tx = 0; tx < tilesX; tx++) {
      const zs: number[] = [];
      for (let y = ty * SIZE; y < Math.min((ty + 1) * SIZE, view.height); y++)
        for (let x = tx * SIZE; x < Math.min((tx + 1) * SIZE, view.width); x++)
          if (depths[y * view.width + x] > 0) zs.push(depths[y * view.width + x]);
      if (!zs.length) continue;
      const bounds = tileBounds(view, [tx, ty], Math.max(...zs), Math.min(...zs));
      const kept = lights.flatMap(({ centre, radius }, rank) =>
        sliceHits(bounds, toTileFrame(view, centre), radius).opaque ? [rank] : [],
      );
      const base = (ty * tilesX + tx) * K.TILE_STRIDE;
      records[base] = kept.length;
      records[base + K.TILE_SHADOW_BASE] = kept.some((rank) => slots[rank] > -1) ? 1 : 0;
      // A list past `TILE_LIGHTS` lives in the pool: its count is all a full sum needs here.
      records.set(kept.slice(0, K.TILE_LIGHTS), base + K.TILE_OPAQUE_BASE);
    }
  return { records, tilesX, tilesY };
}

/**
 * Evaluations per covered pixel of `view` over `depths`, a sampled rank: `list` the lights of the
 * lists, `develop` the resolve before #1249 (every sampled rank drawn), `moving` the shipped one.
 * `slots[rank]` is each light's shadow slot, −1 for none.
 */
export function countSampled(
  view: TileView,
  depths: Float32Array,
  lights: Light[],
  slots: number[],
) {
  const { records, tilesX, tilesY } = tileRecords(view, depths, lights, slots);
  let evaluations = 0;
  const kept = (tile: { x: number; y: number }) =>
    records[(tile.y * tilesX + tile.x) * K.TILE_STRIDE];
  const full = (...args: unknown[]) => (evaluations += kept(args[7] as { x: number; y: number }));
  const sampled = (...args: unknown[]) => {
    const L = kept(args[7] as { x: number; y: number });
    evaluations += L <= K.LIGHT_SAMPLES || L > K.TILE_LIGHTS ? L : 3 * L + K.LIGHT_SAMPLES;
  };
  const { contractLighting } = shaderFunctions<{ contractLighting: Contract }>(
    DIRECT_LIGHTING_WGSL,
    ['contractLighting', 'tileShadowed', 'sampledList', 'pixelTile'],
    {
      ...K,
      view: { lightParams: { x: lights.length, y: tilesX, z: tilesY }, viewport: { w: 1 } },
      vec3f: () => 0,
      tileLights: records,
      directLights: { items: slots.map((slot) => ({ params: { y: slot } })) },
      tileLighting: full,
      sampledTileLighting: sampled,
    },
  );
  const sums = { covered: 0, list: 0, develop: 0, moving: 0 };
  for (let y = 0; y < view.height; y++)
    for (let x = 0; x < view.width; x++) {
      if (!(depths[y * view.width + x] > 0)) continue;
      const tile = { x: Math.floor(x / SIZE), y: Math.floor(y / SIZE) };
      sums.covered++;
      sums.list += kept(tile);
      evaluations = 0;
      sampled(0, 0, 0, 0, 0, 0, 0, tile);
      sums.develop += evaluations;
      evaluations = 0;
      contractLighting(0, 0, 0, 0, 0, 0, 0, { x: x + 0.5, y: y + 0.5 });
      sums.moving += evaluations;
    }
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
