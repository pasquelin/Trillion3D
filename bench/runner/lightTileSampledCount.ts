// Light evaluations per covered pixel of a MOVING image (#1249). The shipped `contractLighting`,
// `tileShadowed` and cluster slice mapping run as JavaScript on each tile's lists: a still or
// unshadowed pixel reads its cluster list (`clusterLighting`), a shadowed one the sampled resolve
// (`3·L + LIGHT_SAMPLES`). COUNTED, never timed.
//
//   node bench/runner/lightTileSampledCount.ts [--width 3456] [--height 2234]
import { parseArgs } from 'node:util';
import { LIGHT_SETTINGS } from '../../packages/sdk-core/src/index.ts';
import { DIRECT_LIGHTING_WGSL } from '../../packages/sdk-browser/src/lighting/direct/lightingWgsl.ts';
import {
  shaderFunctions,
  wgslConstants,
} from '../../packages/sdk-browser/src/texture/shaderRule.fixture.ts';
import {
  NEAR,
  camera,
  pixelPoint,
} from '../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import { CLUSTER_SLICES } from '../../packages/sdk-browser/src/lighting/tiles/clusterWgsl.ts';
import { sliceMap } from '../../packages/sdk-browser/src/lighting/tiles/clusterSlices.fixture.ts';
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
const MAP = sliceMap();

/** The view axis of the pass's frame: the centre ray's direction. */
const axisOf = (view: TileView) => {
  const [cx, cy] = [view.width / 2, view.height / 2];
  const [near, deep] = [pixelPoint(view, cx, cy, 1), pixelPoint(view, cx, cy, NEAR / 1024)];
  const d = [deep[0] - near[0], deep[1] - near[1], deep[2] - near[2]];
  const len = Math.hypot(...d) || 1;
  return d.map((v) => v / len);
};

/** Each tile's record, its opaque list, and the per-slice counts the tile pass's binning writes:
 *  a light's view-axis span, in metres, binned into the cluster lists the resolve walks (#1249). */
function tileRecords(view: TileView, depths: Float32Array, lights: Light[], slots: number[]) {
  const [tilesX, tilesY] = [Math.ceil(view.width / SIZE), Math.ceil(view.height / SIZE)];
  const records = new Uint32Array(tilesX * tilesY * K.TILE_STRIDE);
  const axis = axisOf(view);
  const counts: number[][] = [],
    fronts: number[] = [],
    backs: number[] = [];
  for (let ty = 0; ty < tilesY; ty++)
    for (let tx = 0; tx < tilesX; tx++) {
      const index = ty * tilesX + tx;
      const zs: number[] = [];
      for (let y = ty * SIZE; y < Math.min((ty + 1) * SIZE, view.height); y++)
        for (let x = tx * SIZE; x < Math.min((tx + 1) * SIZE, view.width); x++)
          if (depths[y * view.width + x] > 0) zs.push(depths[y * view.width + x]);
      counts[index] = Array<number>(CLUSTER_SLICES).fill(0);
      fronts[index] = backs[index] = 0;
      if (!zs.length) continue;
      const bounds = tileBounds(view, [tx, ty], Math.max(...zs), Math.min(...zs));
      const kept = lights.flatMap(({ centre, radius }, rank) =>
        sliceHits(bounds, toTileFrame(view, centre), radius).opaque ? [rank] : [],
      );
      const base = index * K.TILE_STRIDE;
      records[base] = kept.length;
      records[base + K.TILE_SHADOW_BASE] = kept.some((rank) => slots[rank] > -1) ? 1 : 0;
      records.set(kept.slice(0, K.TILE_LIGHTS), base + K.TILE_OPAQUE_BASE);
      // The tile's own depth range sets its slices: a light is binned where its sphere can reach.
      const [zFront, zBack] = [Math.max(...zs), Math.min(...zs)];
      const [front, back] = [NEAR / zFront, NEAR / zBack];
      fronts[index] = front;
      backs[index] = back;
      for (const rank of kept) {
        const { centre, radius } = lights[rank];
        const at = [
          centre[0] - view.origin[0],
          centre[1] - view.origin[1],
          centre[2] - view.origin[2],
        ];
        const span = MAP.clusterSliceSpan(
          at[0] * axis[0] + at[1] * axis[1] + at[2] * axis[2],
          radius,
          front,
          back,
        );
        for (let s = span.x; s < span.y; s++) counts[index][s]++;
      }
    }
  return { records, counts, fronts, backs, tilesX, tilesY };
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
  const { records, counts, fronts, backs, tilesX, tilesY } = tileRecords(
    view,
    depths,
    lights,
    slots,
  );
  let evaluations = 0;
  const kept = (tile: { x: number; y: number }) =>
    records[(tile.y * tilesX + tile.x) * K.TILE_STRIDE];
  const sampled = (...args: unknown[]) => {
    const L = kept(args[7] as { x: number; y: number });
    evaluations += L <= K.LIGHT_SAMPLES || L > K.TILE_LIGHTS ? L : 3 * L + K.LIGHT_SAMPLES;
  };
  const cluster = (...args: unknown[]) => {
    const pixel = args[7] as { x: number; y: number };
    const index = Math.floor(pixel.y / SIZE) * tilesX + Math.floor(pixel.x / SIZE);
    const L = records[index * K.TILE_STRIDE];
    if (L > K.TILE_LIGHTS) return void (evaluations += L); // no cluster past the list: all of it
    const z = depths[Math.floor(pixel.y) * view.width + Math.floor(pixel.x)];
    const slice = MAP.clusterSliceIndex(NEAR / z, fronts[index], backs[index]);
    evaluations += counts[index][slice] ?? 0;
  };
  const { contractLighting } = shaderFunctions<{ contractLighting: Contract }>(
    DIRECT_LIGHTING_WGSL,
    ['contractLighting', 'tileShadowed', 'pixelTile'],
    {
      ...K,
      view: { lightParams: { x: lights.length, y: tilesX, z: tilesY }, viewport: { w: 1 } },
      vec3f: () => 0,
      tileLights: records,
      directLights: { items: slots.map((slot) => ({ params: { y: slot } })) },
      clusterLighting: cluster,
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
