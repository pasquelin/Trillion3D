// Light evaluations per covered pixel of a MOVING image (#1249). The shipped `contractLighting` and
// `tileShadowed` run as JavaScript on each tile's lists, and the tile pass's own light grid
// (`passMasks`) fills each record's slice masks: a still or unshadowed pixel walks the lights its
// slice mask names (`walked`, each a range reject test) and shades those in range (`shaded`, each
// a `declaredLight`); a shadowed one the sampled resolve (`3·L + LIGHT_SAMPLES`). COUNTED, never
// timed.
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
import {
  clusterRun,
  passMasks,
  sliceMap,
} from '../../packages/sdk-browser/src/lighting/tiles/clusterSlices.fixture.ts';
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

/** A tile's record, its list or pool past it, and its grid: `kept` ranks, `front` and `back` its
 *  nearest and farthest surface in metres, zero when a pixel sees the sky (full masks). */
type Tile = { record: Uint32Array; kept: number[]; front: number; back: number };

/** Each tile's record as the tile pass leaves it: the opaque list, its shadow flag, its grid. */
function tileRecords(view: TileView, depths: Float32Array, lights: Light[], slots: number[]) {
  const [tilesX, tilesY] = [Math.ceil(view.width / SIZE), Math.ceil(view.height / SIZE)];
  const axis = axisOf(view);
  const onAxis = lights.map(({ centre, radius }) => ({
    positionRange: {
      xyz: [0, 1, 2].reduce((sum, i) => sum + (centre[i] - view.origin[i]) * axis[i], 0),
      w: radius,
    },
    params: { x: 0 },
  }));
  const tiles: Tile[] = [];
  for (let ty = 0; ty < tilesY; ty++)
    for (let tx = 0; tx < tilesX; tx++) {
      const zs: number[] = [];
      for (let y = ty * SIZE; y < Math.min((ty + 1) * SIZE, view.height); y++)
        for (let x = tx * SIZE; x < Math.min((tx + 1) * SIZE, view.width); x++)
          zs.push(depths[y * view.width + x]);
      const covered = zs.filter((z) => z > 0);
      const bounds = covered.length
        ? tileBounds(view, [tx, ty], Math.max(...covered), Math.min(...covered))
        : undefined;
      const kept = bounds
        ? lights.flatMap(({ centre, radius }, rank) =>
            sliceHits(bounds, toTileFrame(view, centre), radius).opaque ? [rank] : [],
          )
        : [];
      const record = new Uint32Array(K.TILE_STRIDE + kept.length);
      record[0] = kept.length;
      record[K.TILE_SHADOW_BASE] = kept.some((rank) => slots[rank] > -1) ? 1 : 0;
      if (kept.length <= K.TILE_LIGHTS) record.set(kept, K.TILE_OPAQUE_BASE);
      else record.set(kept, (record[K.TILE_OPAQUE_BASE] = K.TILE_STRIDE));
      // The pass's grid: off, full masks, where a pixel sees the sky or no light is kept.
      const [zFront, zBack] = [Math.max(...zs), Math.min(...zs)];
      const on = kept.length > 0 && zBack > 0;
      const [front, back] = on ? [NEAR / Math.fround(zFront), NEAR / Math.fround(zBack)] : [0, 0];
      if (on) passMasks(record, 0, onAxis, front, back);
      else record.fill(0xffffffff, K.TILE_CLUSTER_BASE, K.TILE_CLUSTER_BASE + 2 * K.CLUSTER_SLICES);
      tiles.push({ record, kept, front, back });
    }
  return { tiles, tilesX, tilesY };
}

/**
 * Evaluations per covered pixel of `view` over `depths`, a sampled rank: `list` the lights of the
 * lists, `develop` the resolve before #1249 (every sampled rank drawn), `moving` the shipped one's
 * walk, and `shaded` the lights its unshadowed pixels shade in full. `slots[rank]` is each light's
 * shadow slot, −1 for none.
 */
export function countSampled(
  view: TileView,
  depths: Float32Array,
  lights: Light[],
  slots: number[],
) {
  const { tiles, tilesX, tilesY } = tileRecords(view, depths, lights, slots);
  const sums = { covered: 0, list: 0, develop: 0, moving: 0, shaded: 0 };
  const at = (tile: { x: number; y: number }) => tiles[tile.y * tilesX + tile.x];
  const sampled = (...args: unknown[]) => {
    const L = at(args[7] as { x: number; y: number }).kept.length;
    sums.moving += L <= K.LIGHT_SAMPLES || L > K.TILE_LIGHTS ? L : 3 * L + K.LIGHT_SAMPLES;
  };
  // The pixel's slice mask, each bit a group of the walked slice; each walked light tested in range.
  const cluster = (...args: unknown[]) => {
    const { x, y } = args[9] as { x: number; y: number };
    const tile = at({ x: Math.floor(x / SIZE), y: Math.floor(y / SIZE) });
    const z = depths[Math.floor(y) * view.width + Math.floor(x)];
    const slice = MAP.clusterSliceIndex(NEAR / Math.fround(z), tile.front, tile.back);
    const group = clusterRun(tile.kept.length);
    const point = pixelPoint(view, Math.floor(x), Math.floor(y), z);
    tile.kept.forEach((rank, index) => {
      const bit = Math.floor(index / group);
      const word = tile.record[K.TILE_CLUSTER_BASE + 2 * slice + (bit >> 5)];
      if (!((word >>> (bit & 31)) & 1)) return;
      sums.moving++;
      const { centre, radius } = lights[rank];
      if (Math.hypot(...centre.map((c, i) => c - point[i])) < radius) sums.shaded++;
    });
  };
  const records = new Uint32Array(tiles.length * K.TILE_STRIDE);
  tiles.forEach(({ record }, index) =>
    records.set(record.subarray(0, K.TILE_STRIDE), index * K.TILE_STRIDE),
  );
  const { contractLighting } = shaderFunctions<{ contractLighting: Contract }>(
    DIRECT_LIGHTING_WGSL,
    ['contractLighting', 'tileShadowed', 'pixelTile'],
    {
      ...K,
      view: { lightParams: { x: lights.length, y: tilesX, z: tilesY }, viewport: { w: 1 } },
      vec3f: () => 0,
      tileLights: records,
      clusterLighting: cluster,
      sampledTileLighting: sampled,
    },
  );
  for (let y = 0; y < view.height; y++)
    for (let x = 0; x < view.width; x++) {
      if (!(depths[y * view.width + x] > 0)) continue;
      const tile = { x: Math.floor(x / SIZE), y: Math.floor(y / SIZE) };
      const L = at(tile).kept.length;
      sums.covered++;
      sums.list += L;
      sums.develop += L <= K.LIGHT_SAMPLES || L > K.TILE_LIGHTS ? L : 3 * L + K.LIGHT_SAMPLES;
      contractLighting(0, 0, 0, 0, 0, 0, 0, { x: x + 0.5, y: y + 0.5 });
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
      shaded: per(s.shaded),
    };
  });
  console.log(
    `Moving image, 200 unshadowed lamps of range 4 m, ${width} × ${height}, per covered pixel:`,
  );
  console.table(rows);
}

if (import.meta.main) await main();
